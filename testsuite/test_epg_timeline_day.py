import ast
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path
import time
from types import SimpleNamespace
import unittest
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / 'plugin/controllers/models/services.py'
REFS = ('1:0:1:20:', '1:0:1:10:')


class EpgTimelineDayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(SERVICES.read_text(encoding='utf-8'))
        function = next(node for node in source.body
                        if isinstance(node, ast.FunctionDef) and node.name == 'getMultiEpg')
        cls.code = compile(ast.Module(body=[function], type_ignores=[]), str(SERVICES), 'exec')

    def setUp(self):
        self.start = int(time.mktime((2026, 10, 4, 0, 0, 0, -1, -1, -1)))
        self.end = int(time.mktime((2026, 10, 5, 0, 0, 0, -1, -1, -1)))
        self.day_events = []
        self.midnight_events = []
        self.calls = []
        self.timers = []
        self.have_services = True

    def event(self, event_id, begin, duration, ref=REFS[0]):
        return (event_id, begin, 'Event ' + str(event_id), 'Description', ref, 'Channel', duration)

    def get_epg(self, begin=None, mode=2, modern=True, localtime=time.localtime, mktime=time.mktime):
        def query(refs, start, *duration):
            self.calls.append((refs, start, duration))
            return self.day_events if duration else self.midnight_events

        namespace = {
            'OrderedDict': OrderedDict, 'datetime': datetime, 'timedelta': timedelta,
            'eServiceCenter': SimpleNamespace(getInstance=lambda: SimpleNamespace(
                list=lambda _: SimpleNamespace(getContent=lambda _: list(REFS)) if self.have_services else None)),
            'eServiceReference': lambda value: value,
            'EPG': lambda: SimpleNamespace(getMultiChannelEvents=query),
            'localtime': localtime, 'mktime': mktime, 'time': lambda: self.start + 12 * 3600,
            'config': SimpleNamespace(epg=SimpleNamespace(histminutes=SimpleNamespace(value=0)),
                                     OpenWebif=SimpleNamespace(webcache=SimpleNamespace(
                                         showepghistory=SimpleNamespace(value=False)))),
            'getPicon': lambda ref: '/picon/' + ref,
            'filterName': lambda value: value, 'convertDesc': lambda value: value,
        }
        exec(self.code, namespace)
        controller = SimpleNamespace(session=SimpleNamespace(nav=SimpleNamespace(
            RecordTimer=SimpleNamespace(timer_list=self.timers, processed_timers=[]))))
        return namespace['getMultiEpg'](controller, 'bouquet', self.start if begin is None else begin,
                                        1440, mode, modern=modern)

    def events(self, result, ref=REFS[0]):
        return result['events'].get(ref, [[]])[0]

    def test_midnight_boundaries_deduplication_and_original_metadata(self):
        overnight = self.event(1, self.start - 1800, 3600)
        at_start = self.event(3, self.start, 3600)
        late = self.event(4, self.end - 1800, 5400)
        at_end = self.event(5, self.end, 7200)
        self.day_events = [at_end, late, at_start, overnight, at_start,
                           self.event(6, self.end + 1, 3600), self.event(2, self.start - 3600, 3600)]
        self.midnight_events = [overnight, at_start]
        result = self.get_epg(begin=self.start + 12 * 3600)
        self.assertEqual([event['id'] for event in self.events(result)], [1, 3, 4, 5])
        self.assertEqual((self.events(result)[0]['begin_timestamp'], self.events(result)[0]['duration']),
                         (self.start - 1800, 3600))
        self.assertEqual((result['slot_start'], result['timeline_start'], result['timeline_end']),
                         (self.start, self.start, self.end + 7200))
        self.assertEqual(self.calls, [(list(REFS), self.start, (1441,)), (list(REFS), self.start, ())])

    def test_multiday_midnight_event_and_shared_latest_end_in_bouquet_order(self):
        long_event = self.event(1, self.start - 3 * 86400, 7 * 86400)
        self.day_events = [self.event(2, self.start + 3600, 3600, REFS[1])]
        self.midnight_events = [long_event]
        result = self.get_epg()
        self.assertEqual(list(result['events']), list(REFS))
        self.assertEqual(result['timeline_end'], self.start + 4 * 86400)
        self.assertEqual(self.events(result)[0]['duration'], 7 * 86400)

    def test_empty_invalid_and_missing_service_data_keep_selected_day(self):
        for data in (None, [], [None, (), self.event(1, None, 60), self.event(2, self.start, None),
                               self.event(3, self.start, 0), self.event(4, self.start, -60),
                               self.event(5, 'bad', 60)]):
            with self.subTest(data=data):
                self.day_events = data
                result = self.get_epg()
                self.assertEqual(result['events'], {})
                self.assertEqual(result['picons'], {})
                self.assertEqual((result['slot_start'], result['timeline_start'], result['timeline_end']),
                                 (self.start, self.start, self.start))
        self.have_services = False
        result = self.get_epg()
        self.assertFalse(result['result'])
        self.assertEqual((result['slot_start'], result['timeline_start'], result['timeline_end']),
                         (self.start, self.start, self.start))
        self.assertEqual(result['picons'], {})

    def test_today_uses_midnight_without_history_and_other_dates_are_normalized(self):
        for begin in (-1, self.start - 86400 + 1234, self.start + 86400 + 1234):
            with self.subTest(begin=begin):
                self.calls.clear()
                result = self.get_epg(begin=begin)
                expected = self.start if begin == -1 else int(time.mktime((*time.localtime(begin)[:3], 0, 0, 0, -1, -1, -1)))
                self.assertEqual(result['timeline_start'], expected)
                self.assertEqual(self.calls[0][1], expected)

    def test_dst_days_query_actual_calendar_length(self):
        zone = ZoneInfo('Europe/Berlin')

        def localtime(timestamp):
            return datetime.fromtimestamp(timestamp, zone).timetuple()

        def mktime(parts):
            day = datetime(parts[0], parts[1], 1, tzinfo=zone) + timedelta(days=parts[2] - 1)
            return day.replace(hour=parts[3], minute=parts[4], second=parts[5]).timestamp()

        for month, day, hours in ((3, 29, 23), (10, 25, 25)):
            with self.subTest(hours=hours):
                start = int(datetime(2026, month, day, tzinfo=zone).timestamp())
                end = int(datetime(2026, month, day + 1, tzinfo=zone).timestamp())
                self.calls.clear()
                self.day_events = [self.event(1, end, 3600), self.event(2, end + 1, 3600)]
                result = self.get_epg(begin=start + 12 * 3600, localtime=localtime, mktime=mktime)
                self.assertEqual(self.calls, [(list(REFS), start, (hours * 60 + 1,)), (list(REFS), start, ())])
                self.assertEqual([event['id'] for event in self.events(result)], [1])
                self.assertEqual((result['timeline_start'], result['timeline_end']), (start, end + 3600))

    def test_timers_cover_midnight_long_events_and_zaps_before_visible_start(self):
        begins = (self.start - 1800, self.end, self.start - 3 * 86400)
        durations = (3600, 4 * 86400, 7 * 86400)
        for index, (begin, duration) in enumerate(zip(begins, durations)):
            for justplay in (0, 1):
                with self.subTest(begin=begin, justplay=justplay):
                    self.day_events = [self.event(index, begin, duration)]
                    timer_begin = begin + (3 * 86400 if index == 1 and justplay else -60)
                    self.timers = [SimpleNamespace(service_ref=REFS[0], begin=timer_begin,
                                                   end=timer_begin + 1 if justplay else begin + duration + 60,
                                                   eventBegin=begin, eit=index, justplay=justplay, disabled=0)]
                    result = self.get_epg()
                    marker = self.events(result)[0]['timer']
                    self.assertIsNotNone(marker)
                    self.assertEqual((marker['begin'], marker['end']),
                                     (self.timers[0].begin, self.timers[0].end))

    def test_magazine_and_classic_keep_single_query_and_existing_selection(self):
        self.day_events = [self.event(1, self.start, 3600), self.event(2, self.end + 1, 3600)]
        for modern, mode in ((True, 1), (False, 1), (False, 2)):
            with self.subTest(modern=modern, mode=mode):
                self.calls.clear()
                result = self.get_epg(begin=-1, modern=modern, mode=mode)
                self.assertEqual(self.calls, [(list(REFS), self.start + 12 * 3600, (1440,))])
                self.assertNotIn('timeline_end', result)
                if mode == 2:
                    self.assertEqual([event['id'] for slot in result['events']['Channel'] for event in slot], [1, 2])


if __name__ == '__main__':
    unittest.main()