from collections import defaultdict
from datetime import datetime
from html.parser import HTMLParser
from json import loads
from pathlib import Path
from types import ModuleType
from urllib.parse import quote
import time
import unittest
from unittest.mock import call, patch

from Cheetah.Template import Template


class TimerDateRangeParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.times = []
        self.separator = ''
        self.in_time = False
        self.time_attrs = []
        self.items = []
        self.links = []
        self.text = []
        self.duration = ''
        self.in_duration = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'time':
            self.times.append('')
            self.time_attrs.append(attrs)
            self.in_time = True
        if 'data-metadata' in attrs:
            self.items.append(attrs)
        if tag == 'a':
            self.links.append(attrs)
        if tag == 'span' and 'event__duration' in (attrs.get('class') or '').split():
            self.in_duration = True

    def handle_endtag(self, tag):
        if tag == 'time':
            self.in_time = False
        if tag == 'span':
            self.in_duration = False

    def handle_data(self, data):
        self.text.append(data)
        if self.in_time:
            self.times[-1] += data
        elif len(self.times) == 1:
            self.separator += data
        if self.in_duration:
            self.duration += data


class ModernTimerDateRangeTests(unittest.TestCase):
    def render_timer(self, begin, end, compact=True, date_format='%d.%m.%Y', **overrides):
        begin = datetime.fromisoformat(begin)
        end = datetime.fromisoformat(end)
        local_times = {int(value.timestamp()): value.timetuple() for value in (begin, end)}
        timer = {'serviceref': '1:0:1', 'name': 'Film', 'tags': 'Krimi_Drama',
                 'begin': int(begin.timestamp()), 'end': int(end.timestamp()),
                 'disabled': False, 'state': 0, 'justplay': 0, 'servicename': 'Sender',
                 'realbegin': begin.strftime(date_format + ' %H:%M'),
                 'realend': end.strftime(date_format + ' %H:%M'),
                 'duration': int((end - begin).total_seconds()), 'repeated': 0,
                 'description': 'Beschreibung'}
        timer.update(overrides)
        original_timer = timer.copy()
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str, {
            'day_0': 'So', 'day_1': 'Mo', 'day_2': 'Di', 'day_3': 'Mi',
            'day_4': 'Do', 'day_5': 'Fr', 'day_6': 'Sa',
            'disabled': 'Deaktiviert', 'waiting': 'Wartend', 'running': 'Läuft',
            'finished': 'Abgeschlossen', 'mins': 'Minuten', 'every_timer': 'Jeden',
            'monday': 'Montag', 'tuesday': 'Dienstag', 'wednesday': 'Mittwoch',
            'thursday': 'Donnerstag', 'friday': 'Freitag', 'saturday': 'Samstag',
            'sunday': 'Sonntag',
        })
        defaults = ModuleType('Plugins.Extensions.OpenWebif.controllers.defaults')
        defaults.isSettingEnabled = lambda name: 'checked' if compact else ''
        filename = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax/timers.tmpl'
        with patch.dict('sys.modules', {translations.__name__: translations, defaults.__name__: defaults}):
            template_class = Template.compile(file=str(filename), useCache=False)
            template = template_class(searchList=[{'timers': [timer], 'compacttimerlist': compact,
                                                  'time': time}])
            with patch('time.localtime', side_effect=local_times.__getitem__) as receiver_localtime, \
                 patch.dict(template.respond.__globals__, {'localtime': receiver_localtime}):
                rendered = str(template)
        self.assertEqual(receiver_localtime.call_args_list, [call(timer['begin']), call(timer['end'])])
        self.assertEqual(timer, original_timer)
        return rendered, timer

    def assert_range(self, rendered, begin, end, separator):
        parser = TimerDateRangeParser()
        parser.feed(rendered)
        self.assertEqual(parser.times, [begin, end])
        self.assertEqual(parser.separator, separator)

    def test_compact_same_day_shows_end_time_only(self):
        rendered, _ = self.render_timer('2026-10-05T20:15:00+02:00', '2026-10-05T22:00:00+02:00')
        self.assert_range(rendered, 'Mo, 05.10.2026 20:15', '22:00', '-')

    def test_compact_different_days_show_both_dates(self):
        rendered, _ = self.render_timer('2026-10-05T23:15:00+02:00', '2026-10-06T01:00:00+02:00')
        self.assert_range(rendered, 'Mo, 05.10.2026 23:15', 'Di, 06.10.2026 01:00', ' - ')

    def test_card_same_day_shows_end_time_only(self):
        rendered, _ = self.render_timer('2026-10-05T20:15:00+02:00', '2026-10-05T22:00:00+02:00', compact=False)
        self.assert_range(rendered, 'Mo, 05.10.2026 20:15', '22:00', '-')

    def test_card_different_days_show_both_dates(self):
        rendered, _ = self.render_timer('2026-10-05T23:15:00+02:00', '2026-10-06T01:00:00+02:00', compact=False)
        self.assert_range(rendered, 'Mo, 05.10.2026 23:15', 'Di, 06.10.2026 01:00', ' - ')
        parser = TimerDateRangeParser()
        parser.feed(rendered)
        self.assertEqual(parser.time_attrs, [{'style': 'white-space: nowrap;'}] * 2)

    def test_calendar_boundaries_show_complete_end_date(self):
        cases = (
            ('2026-10-05T23:15:00+02:00', '2026-10-06T00:00:00+02:00',
             'Mo, 05.10.2026 23:15', 'Di, 06.10.2026 00:00'),
            ('2026-10-31T23:15:00+01:00', '2026-11-01T01:00:00+01:00',
             'Sa, 31.10.2026 23:15', 'So, 01.11.2026 01:00'),
            ('2026-12-31T23:15:00+01:00', '2027-01-01T01:00:00+01:00',
             'Do, 31.12.2026 23:15', 'Fr, 01.01.2027 01:00'),
            ('2026-10-05T20:15:00+02:00', '2026-10-12T22:00:00+02:00',
             'Mo, 05.10.2026 20:15', 'Mo, 12.10.2026 22:00'),
            ('2026-10-05T20:15:00+02:00', '2027-10-05T22:00:00+02:00',
             'Mo, 05.10.2026 20:15', 'Di, 05.10.2027 22:00'),
        )
        for compact in (False, True):
            for begin, end, begin_display, end_display in cases:
                with self.subTest(compact=compact, begin=begin, end=end):
                    rendered, _ = self.render_timer(begin, end, compact=compact)
                    self.assert_range(rendered, begin_display, end_display, ' - ')

    def test_receiver_calendar_day_takes_precedence_over_utc(self):
        for compact in (False, True):
            with self.subTest(compact=compact):
                rendered, _ = self.render_timer('2026-10-05T00:15:00+02:00',
                                                '2026-10-05T03:00:00+02:00', compact=compact)
                self.assert_range(rendered, 'Mo, 05.10.2026 00:15', '03:00', '-')
                rendered, _ = self.render_timer('2026-10-05T23:15:00+02:00',
                                                '2026-10-06T01:00:00+02:00', compact=compact)
                self.assert_range(rendered, 'Mo, 05.10.2026 23:15', 'Di, 06.10.2026 01:00', ' - ')

    def test_daylight_saving_uses_local_calendar_dates(self):
        cases = (
            ('2026-03-29T01:30:00+01:00', '2026-03-29T03:30:00+02:00',
             'So, 29.03.2026 01:30', '03:30', '-', 60),
            ('2026-10-25T02:30:00+02:00', '2026-10-25T02:15:00+01:00',
             'So, 25.10.2026 02:30', '02:15', '-', 45),
            ('2026-03-28T23:30:00+01:00', '2026-03-29T03:30:00+02:00',
             'Sa, 28.03.2026 23:30', 'So, 29.03.2026 03:30', ' - ', 180),
            ('2026-10-24T23:30:00+02:00', '2026-10-25T03:30:00+01:00',
             'Sa, 24.10.2026 23:30', 'So, 25.10.2026 03:30', ' - ', 300),
        )
        for compact in (False, True):
            for begin, end, begin_display, end_display, separator, minutes in cases:
                with self.subTest(compact=compact, begin=begin, end=end):
                    rendered, _ = self.render_timer(begin, end, compact=compact)
                    self.assert_range(rendered, begin_display, end_display, separator)
                    parser = TimerDateRangeParser()
                    parser.feed(rendered)
                    self.assertEqual(parser.duration, '' if compact else '(%s Minuten)' % minutes)

    def test_existing_localized_date_format_is_preserved(self):
        for compact in (False, True):
            with self.subTest(compact=compact):
                rendered, _ = self.render_timer('2026-10-05T20:15:00+02:00', '2026-10-05T22:00:00+02:00',
                                                compact=compact, date_format='%m/%d/%Y')
                self.assert_range(rendered, 'Mo, 10/05/2026 20:15', '22:00', '-')
                rendered, _ = self.render_timer('2026-10-05T23:15:00+02:00', '2026-10-06T01:00:00+02:00',
                                                compact=compact, date_format='%m/%d/%Y')
                self.assert_range(rendered, 'Mo, 10/05/2026 23:15', 'Di, 10/06/2026 01:00', ' - ')

    def test_zap_card_keeps_end_and_duration_hidden(self):
        for end in ('2026-10-05T22:00:00+02:00', '2026-10-06T01:00:00+02:00'):
            with self.subTest(end=end):
                rendered, _ = self.render_timer('2026-10-05T20:15:00+02:00', end, compact=False, justplay=1)
                parser = TimerDateRangeParser()
                parser.feed(rendered)
                self.assertEqual(parser.times, ['Mo, 05.10.2026 20:15'])
                self.assertEqual(parser.duration, '')
                self.assertIn('settings_remote', parser.text)

    def test_compact_zap_keeps_end_visible(self):
        rendered, _ = self.render_timer('2026-10-05T20:15:00+02:00', '2026-10-05T22:00:00+02:00', justplay=1)
        self.assert_range(rendered, 'Mo, 05.10.2026 20:15', '22:00', '-')
        rendered, _ = self.render_timer('2026-10-05T23:15:00+02:00', '2026-10-06T01:00:00+02:00', justplay=1)
        self.assert_range(rendered, 'Mo, 05.10.2026 23:15', 'Di, 06.10.2026 01:00', ' - ')

    def test_status_repetition_duration_and_action_metadata_are_preserved(self):
        states = ((False, 0, 'Wartend'), (False, 2, 'Läuft'),
                  (False, 3, 'Abgeschlossen'), (True, 2, 'Deaktiviert'))
        for compact in (False, True):
            for disabled, state, status in states:
                with self.subTest(compact=compact, disabled=disabled, state=state):
                    rendered, timer = self.render_timer('2026-10-05T23:15:00+02:00', '2026-10-06T01:00:00+02:00',
                                                        compact=compact, disabled=disabled, state=state,
                                                        repeated=69, duration=12660,
                                                        serviceref='1:0:1:ä &', name='Film & "Serie"')
                    parser = TimerDateRangeParser()
                    parser.feed(rendered)
                    visible = ' '.join(''.join(parser.text).split())
                    self.assertIn(status, visible)
                    self.assertIn('Jeden Montag, Mittwoch, Sonntag', visible)
                    self.assertEqual(parser.duration, '' if compact else '(211 Minuten)')
                    self.assertEqual(len(parser.items), 1)
                    self.assertEqual(parser.items[0]['id'], '%s-%s' % (timer['begin'], timer['end']))
                    self.assertEqual(parser.items[0]['data-filter-tags'], timer['tags'])
                    self.assertEqual(loads(parser.items[0]['data-metadata']),
                                     {'sref': quote(timer['serviceref']), 'begin': timer['begin'], 'end': timer['end']})
                    edit = next(link for link in parser.links if link.get('href') == '#edittimer')
                    self.assertEqual(edit['data-target'], '#TimerModal')
                    sref = quote(timer['serviceref'], safe=' ~@#$()*!+=:;,.?/\'')
                    if compact:
                        self.assertEqual(edit['data-ref'], sref)
                        self.assertEqual(edit['data-begin'], str(timer['begin']))
                        self.assertEqual(edit['data-end'], str(timer['end']))
                    actions = [link['onclick'] for link in parser.links if 'onclick' in link]
                    suffix = ("; lastcontenturl=''; setTimeout(function(){load_maincontent('ajax/timers')}, "
                              "200); return false;")
                    self.assertIn("toggleTimerStatus('%s', '%s', '%s')" %
                                  (sref, timer['begin'], timer['end']) + suffix, actions)
                    self.assertIn("deleteTimer('%s', '%s', '%s', '%s')" %
                                  (sref, timer['begin'], timer['end'], quote(timer['name'])) + suffix, actions)


if __name__ == '__main__':
    unittest.main()