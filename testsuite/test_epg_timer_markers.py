import ast
import importlib.util
from collections import OrderedDict
from pathlib import Path
from time import localtime, mktime
from types import SimpleNamespace
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / 'plugin/controllers/models/services.py'
AJAX = ROOT / 'plugin/controllers/ajax.py'
RENDERER = ROOT / 'plugin/controllers/views/responsive/ajax/renderevtblock.py'
TEMPLATE = ROOT / 'plugin/controllers/views/responsive/ajax/multiepg.tmpl'


class EpgTimerMarkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(SERVICES.read_text(encoding='utf-8'))
        multi_epg = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'getMultiEpg')
        details = next(node for node in multi_epg.body if isinstance(node, ast.FunctionDef) and node.name == 'getTimerDetails')
        namespace = {}
        exec(compile(ast.Module(body=[details], type_ignores=[]), str(SERVICES), 'exec'), namespace)
        cls.get_timer_details = staticmethod(namespace['getTimerDetails'])
        cls.multi_epg_code = compile(ast.Module(body=[multi_epg], type_ignores=[]), str(SERVICES), 'exec')

        spec = importlib.util.spec_from_file_location('responsive_epg_renderer', RENDERER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.renderer = module.renderEvtBlock()
        cls.template = TEMPLATE.read_text(encoding='utf-8')

    def event(self, timer):
        return {'id': 1, 'ref': '1:0:1:', 'begin_timestamp': 1000, 'duration': 3600,
                'title': 'Test', 'shortdesc': 'Description', 'timer': timer}

    def epg_events(self, timers, mode, modern=True, begin_time=None):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        ref = '1:0:1:'
        events = [(10 + i, start + i * 3600, 'Event', 'Description', ref, 'Channel', 3600)
                  for i in range(3)]
        namespace = {
            'OrderedDict': OrderedDict,
            'eServiceCenter': SimpleNamespace(getInstance=lambda: SimpleNamespace(
                list=lambda _: SimpleNamespace(getContent=lambda _: [ref]))),
            'eServiceReference': lambda value: value,
            'EPG': lambda: SimpleNamespace(getMultiChannelEvents=lambda *_: events),
            'localtime': localtime,
            'mktime': mktime,
            'getPicon': lambda _: '/picon',
            'filterName': lambda value: value,
            'convertDesc': lambda value: value,
        }
        exec(self.multi_epg_code, namespace)
        record_timer = SimpleNamespace(timer_list=timers, processed_timers=[])
        controller = SimpleNamespace(session=SimpleNamespace(nav=SimpleNamespace(RecordTimer=record_timer)))
        result = namespace['getMultiEpg'](controller, 'bouquet',
                                          start + 3630 if begin_time is None else begin_time,
                                          None, mode, modern=modern)
        return [event for slot in result['events']['Channel'] for event in slot]

    def test_short_zap_timer_is_assigned_to_its_event_in_both_views(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        for mode in (1, 2):
            for flags, marker_type in (({'justplay': 1}, 'zap'),
                                       ({'justplay': 1, 'always_zap': 1}, 'record-zap')):
                with self.subTest(mode=mode, marker_type=marker_type):
                    timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                            end=start + 3601, eit=11, disabled=0, **flags)
                    events = self.epg_events([timer], mode)
                    self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                      for event in events], [None, marker_type, None])

    def test_zap_timer_without_eit_matches_event_start(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                end=start + 3601, eit=0, disabled=0, justplay=1)
        events = self.epg_events([timer], 1)
        self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                          for event in events], [None, 'zap', None])

    def test_zap_timer_with_early_start_and_no_end_time(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3300,
                                end=start + 3300, eit=11, disabled=0, justplay=1)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                events = self.epg_events([timer], mode)
                self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                  for event in events], [None, 'zap', None])

    def test_zap_timer_before_day_start_matches_original_event(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start - 300, end=start - 300,
                                eventBegin=start, eit=10, disabled=0, justplay=1)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                events = self.epg_events([timer], mode, begin_time=start)
                self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                  for event in events], ['zap', None, None])

    def test_recording_coverage_and_wrong_zap_eit(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        for mode in (1, 2):
            for flags, expected in (({'justplay': 0}, 'record'),
                                    ({'justplay': 0, 'always_zap': 1}, 'record-zap')):
                with self.subTest(mode=mode, expected=expected):
                    timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3540,
                                            end=start + 7260, disabled=0, **flags)
                    events = self.epg_events([timer], mode)
                    self.assertEqual([event['timer']['markerType'] if event['timer'] else None
                                      for event in events], [None, expected, None])

            wrong_eit = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                        end=start + 3601, eit=42, disabled=0, justplay=1)
            with self.subTest(mode=mode, expected=None):
                self.assertTrue(all(event['timer'] is None for event in self.epg_events([wrong_eit], mode)))

    def test_classic_epg_keeps_existing_short_timer_behavior(self):
        start = int(mktime((2026, 9, 28, 0, 0, 0, -1, -1, -1)))
        timer = SimpleNamespace(service_ref='1:0:1:', begin=start + 3600,
                                end=start + 3601, eit=11, disabled=0, justplay=1)
        for mode in (1, 2):
            with self.subTest(mode=mode):
                self.assertTrue(all(event['timer'] is None
                                    for event in self.epg_events([timer], mode, modern=False)))

    def test_controller_enables_short_zaps_only_for_responsive_template(self):
        source = ast.parse(AJAX.read_text(encoding='utf-8'))
        controller = next(node for node in source.body if isinstance(node, ast.ClassDef)
                          and node.name == 'AjaxController')
        handler = next(node for node in controller.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'P_multiepg')
        for view, modern in (('responsive', True), ('ajax', False)):
            with self.subTest(view=view):
                path = '/views/responsive/ajax/multiepg.tmpl' if modern else '/views/ajax/multiepg.tmpl'
                namespace = {
                    'getUrlArg': lambda request, name, default=None: default,
                    'getBouquets': lambda mode: {'bouquets': [('bouquet', 'Favorite')]},
                    'getViewsPath': lambda name: path,
                    'VIEWS_PATH': '/views',
                    'getMultiEpg': lambda *args, **kwargs: {'modern': kwargs['modern']},
                    'config': SimpleNamespace(OpenWebif=SimpleNamespace(webcache=SimpleNamespace(
                        mepgmode=SimpleNamespace(value=0), epg_jump_now=SimpleNamespace(value=0),
                        epg_jump_active_service=SimpleNamespace(value=0)))),
                    'NavigationInstance': SimpleNamespace(instance=None),
                }
                exec(compile(ast.Module(body=[handler], type_ignores=[]), str(AJAX), 'exec'), namespace)
                result = namespace['P_multiepg'](SimpleNamespace(), None)
                self.assertIs(result['modern'], modern)

    def test_marker_type_in_both_views(self):
        cases = (
            ('record', {'justplay': 0}, 'record'),
            ('zap', {'justplay': 1}, 'zap'),
            ('record and zap', {'justplay': 0, 'always_zap': 1}, 'record-zap'),
            ('record and zap with justplay flag', {'justplay': 1, 'always_zap': 1}, 'record-zap'),
            ('record and zap on older boxes', {'justplay': 0, 'zapbeforerecord': 1}, 'record-zap'),
            ('disabled zap', {'justplay': 1, 'disabled': 1}, 'zap'),
            ('AutoTimer recording', {'justplay': 0, 'isAutoTimer': 1}, 'record'),
        )
        for name, attributes, expected in cases:
            with self.subTest(name=name):
                timer = SimpleNamespace(disabled=0, justplay=0, always_zap=0, isAutoTimer=0)
                for key, value in attributes.items():
                    setattr(timer, key, value)
                details = self.get_timer_details(timer)
                self.assertEqual(details['markerType'], expected)
                self.assertIn('event--has-timer timer--' + expected, self.renderer.render(self.event(details)))
                self.assertIn("$event['timer']['markerType']", self.template)
                self.assertIn('class="event$timerClass"', self.template)

    def test_zap_timer_without_always_zap(self):
        timer = SimpleNamespace(disabled=0, justplay=1)
        self.assertEqual(self.get_timer_details(timer)['markerType'], 'zap')

    def test_events_without_timers_have_no_marker(self):
        self.assertNotIn('event--has-timer', self.renderer.render(self.event(None)))
        self.assertIn("#if $event['timer']", self.template)

    def test_marker_colors_are_shared_between_views(self):
        self.assertIn('.epg__event.event--has-timer::after', self.template)
        self.assertIn('.event.event--has-timer::before', self.template)
        self.assertIn('background: var(--epg-timer-marker)', self.template)
        for timer_type, color in (('record', '#e53935'), ('zap', '#1e88e5')):
            self.assertIn('.timer--' + timer_type + ' { --epg-timer-marker: ' + color, self.template)
        self.assertIn('.timer--record-zap { --epg-timer-marker: linear-gradient(to bottom, #e53935 50%, #1e88e5 50%)', self.template)


if __name__ == '__main__':
    unittest.main()