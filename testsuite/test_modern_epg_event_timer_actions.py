import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / 'plugin/controllers/models/services.py'
AJAX = ROOT / 'plugin/controllers/ajax.py'
TEMPLATE = ROOT / 'plugin/controllers/views/responsive/ajax/event.tmpl'
RESPONSIVE_JS = ROOT / 'sourcefiles/modern/js/responsive.js'
BUNDLED_JS = ROOT / 'plugin/public/modern/js/responsive.min.js'


class ModernEpgEventTimerActionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        services = ast.parse(SERVICES.read_text(encoding='utf-8'))
        functions = [node for node in services.body if isinstance(node, ast.FunctionDef)
                     and node.name in ('getTimerEventStatus', 'getEvent')]
        cls.services_code = compile(ast.Module(body=functions, type_ignores=[]), str(SERVICES), 'exec')

        ajax = ast.parse(AJAX.read_text(encoding='utf-8'))
        controller = next(node for node in ajax.body if isinstance(node, ast.ClassDef)
                          and node.name == 'AjaxController')
        handler = next(node for node in controller.body if isinstance(node, ast.FunctionDef)
                       and node.name == 'P_event')
        cls.controller_code = compile(ast.Module(body=[handler], type_ignores=[]), str(AJAX), 'exec')

    def event(self, timers, modern=True):
        reference = '1:0:1:'
        event = (11, 1000, 3600, 'Test', 'Description', 'Details', 'Channel', reference, None)
        namespace = {
            'EPG': lambda: SimpleNamespace(getEvent=lambda *_: event),
            'NavigationInstance': SimpleNamespace(instance=SimpleNamespace(RecordTimer=SimpleNamespace(
                timer_list=timers, processed_timers=[]))),
            'strftime': lambda *_: '12:00', 'localtime': lambda *_: None,
            'filterName': lambda value, encode: value,
            'convertDesc': lambda value, encode: value,
            'convertGenre': lambda value: ('', 0),
            'getPicon': lambda value: '', 'getIPTVLink': lambda value: '',
        }
        exec(self.services_code, namespace)
        return namespace['getEvent'](reference, 11, modern=modern)['event']

    def timer(self, **kwargs):
        attributes = {'service_ref': '1:0:1:', 'begin': 900, 'end': 4700,
                      'disabled': 0, 'justplay': 0, 'eit': 11}
        attributes.update(kwargs)
        return SimpleNamespace(**attributes)

    def test_recording_timer_exposes_exact_identity_only_in_modern_popup(self):
        timer = self.timer(begin=880, end=4780)
        details = self.event([timer])['timer']
        self.assertEqual((details['sref'], details['begin'], details['end']),
                         (timer.service_ref, timer.begin, timer.end))
        self.assertEqual(details['isEnabled'], 1)
        self.assertIsNone(self.event([timer], modern=False)['timer'])

    def test_short_zap_and_disabled_timer_are_available(self):
        timer = self.timer(begin=940, end=941, disabled=1, justplay=1)
        details = self.event([timer])['timer']
        self.assertEqual((details['begin'], details['end']), (940, 941))
        self.assertEqual(details['isEnabled'], 0)

    def test_processed_timer_and_zap_without_event_id(self):
        reference = '1:0:1:'
        event = (11, 1000, 3600, 'Test', 'Description', 'Details', 'Channel', reference, None)
        timer = self.timer(begin=1000, end=1001, eit=None, justplay=1, eventBegin=1000)
        namespace = {
            'EPG': lambda: SimpleNamespace(getEvent=lambda *_: event),
            'NavigationInstance': SimpleNamespace(instance=SimpleNamespace(RecordTimer=SimpleNamespace(
                timer_list=[], processed_timers=[timer]))),
            'strftime': lambda *_: '12:00', 'localtime': lambda *_: None,
            'filterName': lambda value, encode: value, 'convertDesc': lambda value, encode: value,
            'convertGenre': lambda value: ('', 0), 'getPicon': lambda value: '',
            'getIPTVLink': lambda value: '',
        }
        exec(self.services_code, namespace)
        self.assertEqual(namespace['getEvent'](reference, 11, modern=True)['event']['timer']['begin'], 1000)

    def test_unrelated_timer_does_not_offer_actions(self):
        self.assertIsNone(self.event([])['timer'])
        self.assertIsNone(self.event([self.timer(service_ref='other')])['timer'])
        self.assertIsNone(self.event([self.timer(begin=5100, end=6000, eit=12)])['timer'])

    def test_controller_enables_modern_matching_only_for_responsive_view(self):
        for modern in (True, False):
            with self.subTest(modern=modern):
                path = '/views/responsive/ajax/event.tmpl' if modern else '/views/ajax/event.tmpl'
                namespace = {
                    'getViewsPath': lambda name: path, 'VIEWS_PATH': '/views',
                    'getUrlArg': lambda request, name: '',
                    'getEvent': lambda *args, **kwargs: {'event': {'timer': kwargs.get('modern')}},
                    'config': SimpleNamespace(recording=SimpleNamespace(
                        margin_before=SimpleNamespace(value=0), margin_after=SimpleNamespace(value=0)),
                        OpenWebif=SimpleNamespace(webcache=SimpleNamespace(moviedb=SimpleNamespace(value='')))),
                    'globalVars': SimpleNamespace(hasAutoTimer=False, transcoding=False),
                    'EXT_EVENT_INFO_SOURCE': '', 'getEventInfoProvider': lambda value: None,
                }
                exec(self.controller_code, namespace)
                result = namespace['P_event'](SimpleNamespace(), None)
                self.assertIs(result['event']['timer'], modern)

    def test_template_uses_timer_identity_for_conditional_actions(self):
        template = TEMPLATE.read_text(encoding='utf-8')
        timer_actions = template.split('#if $event.timer\n', 1)[1].split('#end if\n\n\t\t<button onclick="addTimerEvent', 1)[0]
        self.assertIn('data-target="#TimerModal"', timer_actions)
        self.assertIn('$event.timer.begin', template)
        self.assertIn('$event.timer.end', template)
        self.assertIn('deleteTimer(', template)
        self.assertIn('loadeventepg(\'$event.id\', decodeURIComponent(\'$sRefQuoteEscaped\'))', timer_actions)

    def test_add_actions_remain_available_with_or_without_timer(self):
        template = TEMPLATE.read_text(encoding='utf-8')
        actions = template.split('#if $event.timer\n', 1)[1].split('#if $at', 1)[0]
        timer_actions, add_actions = actions.rsplit('#end if', 1)
        self.assertNotIn('addTimerEvent(', timer_actions)
        self.assertNotIn('deleteTimer(', add_actions)
        self.assertIn('addTimerEvent(\'$sRefQuoteEscaped\', \'$event.id\', false)', add_actions)
        self.assertIn('addTimerEvent(\'$sRefQuoteEscaped\', \'$event.id\', true)', add_actions)
        self.assertIn('data-target="#TimerModal"', add_actions)
        self.assertNotIn('data-metadata="$timerMetadata"', add_actions)

    def test_delete_updates_epg_only_after_success(self):
        source = RESPONSIVE_JS.read_text(encoding='utf-8')
        delete = source.split('function deleteTimer(', 1)[1].split('\nfunction ', 1)[0]
        self.assertIn('webapi_execute_result("/api/timerdelete', delete)
        self.assertIn("if (typeof callback === 'function') callback();", delete)
        self.assertIn('if (state)', delete)
        self.assertIn('webapi_execute_result("/api/timerdelete', BUNDLED_JS.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()