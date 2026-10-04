import ast
from pathlib import Path
from time import localtime, strftime
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


TIMERS = Path(__file__).resolve().parents[1] / 'plugin/controllers/models/timers.py'


class ServiceReferenceDouble:
    def __init__(self, value):
        self.value = value
        self.ref = self

    def toString(self):
        return self.value

    def getServiceName(self):
        return 'Channel'

    def __str__(self):
        return self.value


class TimerDouble(SimpleNamespace):
    def processRepeated(self):
        if self.repeated:
            self.begin += 86400
            self.end += 86400
            self.findRunningEvent = True
            self.findNextEvent = False
            self.start_prepare = self.begin - 20
            self.backoff = 0
            self.log_entries.append((self.begin, 15, 'Time changed'))

    def setAutoincreaseEnd(self, entry):
        if not self.autoincrease:
            return False
        self.end = entry.begin - 30
        return True


class TimerEditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(TIMERS.read_text(encoding='utf-8'))
        function = next(node for node in source.body
                        if isinstance(node, ast.FunctionDef) and node.name == 'editTimer')
        cls.edit_code = compile(ast.Module(body=[function], type_ignores=[]), str(TIMERS), 'exec')

    def setUp(self):
        self.sanity = Mock()
        self.sanity.check.return_value = True
        self.get_timer_obj = Mock(side_effect=lambda timer, _: {
            'name': timer.name, 'begin': timer.begin, 'end': timer.end})
        self.namespace = {
            'ServiceReference': ServiceReferenceDouble,
            'TimerSanityCheck': Mock(return_value=self.sanity),
            'getInfo': lambda: {'timermargins': True},
            'getTimerObj': self.get_timer_obj,
            'removeBad': lambda value: value,
            '_': lambda value: value,
            'strftime': strftime,
            'localtime': localtime,
        }
        exec(self.edit_code, self.namespace)
        self.timer = self.make_timer()
        self.record_timer = SimpleNamespace(timer_list=[self.timer], processed_timers=[], timeChanged=Mock())
        self.session = SimpleNamespace(nav=SimpleNamespace(RecordTimer=self.record_timer))

    def make_timer(self, **changes):
        state = {
            'service_ref': ServiceReferenceDouble('1:0:1:OLD:'),
            'begin': 1000000, 'end': 1003600, 'name': 'Original', 'description': 'Original description',
            'disabled': False, 'justplay': False, 'afterEvent': 0, 'dirname': '/original',
            'tags': ['Original tag'], 'repeated': 0, 'repeatedbegindate': 1000000,
            'always_zap': False, 'zapbeforerecord': False, 'pipzap': False, 'allow_duplicate': True,
            'descramble': True, 'record_ecm': False,
            'marginBefore': 60, 'marginAfter': 120, 'eventBegin': 1000060, 'eventEnd': 1003480,
            'hasEndTime': True, 'start_prepare': 999980, 'backoff': 5,
            'log_entries': [(999000, 0, 'Original log')], 'autoincrease': False,
        }
        state.update(changes)
        return TimerDouble(**state)

    def snapshot(self, timer):
        return {key: value[:] if isinstance(value, list) else value for key, value in vars(timer).items()}

    def edit(self, **changes):
        arguments = {
            'serviceref': '1:0:1:NEW:', 'begin': '2000000.0', 'end': '2007200.0',
            'name': 'Edited', 'description': 'Edited description', 'disabled': True, 'justplay': False,
            'afterevent': 2, 'dirname': '/edited', 'tags': ['Edited tag'], 'repeated': 3,
            'channelold': '1:0:1:OLD:', 'beginold': 1000000, 'endold': 1003600,
            'recordingtype': 'scrambled',
            'vpsinfo': {'vpsplugin_enabled': True, 'vpsplugin_overwrite': True, 'vpsplugin_time': 2000000},
            'always_zap': 1, 'pipzap': 1, 'allow_duplicate': False,
            'marginBefore': 3, 'marginAfter': 4, 'hasEndTime': True,
        }
        arguments.update(changes)
        return self.namespace['editTimer'](self.session, **arguments)

    def reject(self, conflicts=None):
        self.sanity.check.return_value = False
        self.sanity.getSimulTimerList.return_value = conflicts if conflicts is not None else [
            self.timer, self.make_timer(name='Conflict', begin=2000000, end=2007200)]

    def test_rejected_edit_preserves_complete_state_and_identity(self):
        for processed in (False, True):
            with self.subTest(processed=processed):
                self.setUp()
                if processed:
                    self.record_timer.timer_list = []
                    self.record_timer.processed_timers = [self.timer]
                original = self.snapshot(self.timer)
                original_tags = self.timer.tags
                original_logs = self.timer.log_entries
                self.reject()

                result = self.edit(returntimer=True)

                self.assertFalse(result['result'])
                self.assertNotIn('timer', result)
                self.assertEqual(vars(self.timer), original)
                self.assertIs(self.timer.tags, original_tags)
                self.assertIs(self.timer.log_entries, original_logs)
                self.assertIs((self.record_timer.processed_timers if processed else
                               self.record_timer.timer_list)[0], self.timer)
                self.record_timer.timeChanged.assert_not_called()

    def test_rejected_zap_timer_restores_end_time_and_existing_vps(self):
        self.timer.vpsplugin_enabled = False
        self.timer.vpsplugin_overwrite = False
        self.timer.vpsplugin_time = None
        original = self.snapshot(self.timer)
        self.reject()

        result = self.edit(justplay=True, hasEndTime=False, repeated=0)

        self.assertFalse(result['result'])
        self.assertEqual(vars(self.timer), original)
        self.record_timer.timeChanged.assert_not_called()

    def test_rejected_autoincrease_restores_other_timers_without_notifications(self):
        other = self.make_timer(name='Autoincrease', autoincrease=True, end=3000000)
        self.record_timer.timer_list.append(other)
        originals = [self.snapshot(timer) for timer in (self.timer, other)]
        self.reject([self.timer, other])

        result = self.edit()

        self.assertFalse(result['result'])
        for timer, original in zip((self.timer, other), originals):
            self.assertEqual(vars(timer), original)
        self.record_timer.timeChanged.assert_not_called()

    def test_successful_edit_keeps_original_object_and_applies_options(self):
        result = self.edit(returntimer=True)

        self.assertTrue(result['result'])
        self.assertIs(self.record_timer.timer_list[0], self.timer)
        self.record_timer.timeChanged.assert_called_once_with(self.timer)
        self.assertEqual(str(self.timer.service_ref), '1:0:1:NEW:')
        self.assertEqual((self.timer.begin, self.timer.end), (2086400, 2093600))
        self.assertEqual((self.timer.name, self.timer.description), ('Edited', 'Edited description'))
        self.assertEqual((self.timer.disabled, self.timer.justplay, self.timer.afterEvent), (True, False, 2))
        self.assertEqual((self.timer.dirname, self.timer.tags, self.timer.repeated), ('/edited', ['Edited tag'], 3))
        self.assertTrue(self.timer.always_zap and self.timer.zapbeforerecord and self.timer.pipzap)
        self.assertFalse(self.timer.allow_duplicate or self.timer.descramble)
        self.assertTrue(self.timer.record_ecm and self.timer.hasEndTime)
        self.assertTrue(self.timer.vpsplugin_enabled and self.timer.vpsplugin_overwrite)
        self.assertEqual(self.timer.vpsplugin_time, 2000000)
        self.assertEqual((self.timer.marginBefore, self.timer.marginAfter), (180, 240))
        self.assertEqual((self.timer.eventBegin, self.timer.eventEnd), (2086580, 2093360))
        self.assertEqual(len(self.timer.log_entries), 2)
        self.assertEqual(result['timer'], {
            'name': 'Edited', 'begin': 2086400, 'end': 2093600,
            'channelold': '1:0:1:OLD:', 'beginold': 1000000, 'endold': 1003600,
        })

    def test_successful_processed_timer_edit(self):
        self.record_timer.timer_list = []
        self.record_timer.processed_timers = [self.timer]

        result = self.edit(repeated=0)

        self.assertTrue(result['result'])
        self.assertIs(self.record_timer.processed_timers[0], self.timer)
        self.record_timer.timeChanged.assert_called_once_with(self.timer)

    def test_successful_autoincrease_resolves_conflict_before_notifications(self):
        other = self.make_timer(name='Autoincrease', autoincrease=True, end=3000000)
        self.record_timer.timer_list.append(other)
        self.sanity.check.side_effect = [False, True]
        self.sanity.getSimulTimerList.return_value = [self.timer, other]

        result = self.edit(repeated=0)

        self.assertTrue(result['result'])
        self.assertEqual(other.end, self.timer.begin - 30)
        self.assertEqual([call.args[0] for call in self.record_timer.timeChanged.call_args_list],
                         [other, self.timer])

    def test_multiple_autoincrease_changes_are_rolled_back_if_conflict_remains(self):
        others = [self.make_timer(name=name, autoincrease=True, end=3000000)
                  for name in ('Autoincrease one', 'Autoincrease two')]
        self.record_timer.timer_list.extend(others)
        originals = [self.snapshot(timer) for timer in [self.timer] + others]
        self.reject([self.timer] + others)

        result = self.edit()

        self.assertFalse(result['result'])
        for timer, original in zip([self.timer] + others, originals):
            self.assertEqual(vars(timer), original)
        self.record_timer.timeChanged.assert_not_called()

    def test_multiple_autoincrease_changes_are_checked_and_committed_together(self):
        others = [self.make_timer(name=name, autoincrease=True, end=3000000)
                  for name in ('Autoincrease one', 'Autoincrease two')]
        self.record_timer.timer_list.extend(others)
        self.sanity.check.side_effect = [False, True]
        self.sanity.getSimulTimerList.return_value = [self.timer] + others

        result = self.edit(repeated=0)

        self.assertTrue(result['result'])
        self.assertEqual(self.sanity.check.call_count, 2)
        self.assertEqual([timer.end for timer in others], [self.timer.begin - 30] * 2)
        self.assertEqual([call.args[0] for call in self.record_timer.timeChanged.call_args_list],
                         others + [self.timer])

    def test_edited_autoincrease_timer_is_not_shortened_against_itself(self):
        self.timer.autoincrease = True
        original = self.snapshot(self.timer)
        self.reject([self.timer])

        result = self.edit(repeated=0)

        self.assertFalse(result['result'])
        self.assertEqual(result['conflicts'][0]['end'], 2007200)
        self.assertEqual(vars(self.timer), original)
        self.record_timer.timeChanged.assert_not_called()

    def test_successful_edit_without_optional_receiver_features(self):
        for attribute in ('always_zap', 'zapbeforerecord', 'pipzap', 'allow_duplicate'):
            delattr(self.timer, attribute)
        self.namespace['getInfo'] = lambda: {'timermargins': False}

        result = self.edit(repeated=0, vpsinfo=None, recordingtype=None)

        self.assertTrue(result['result'])
        self.assertFalse(hasattr(self.timer, 'always_zap'))
        self.assertFalse(hasattr(self.timer, 'pipzap'))
        self.assertEqual((self.timer.marginBefore, self.timer.marginAfter), (60, 120))
        self.record_timer.timeChanged.assert_called_once_with(self.timer)

    def test_invalid_recording_type_restores_timer_before_propagating_error(self):
        original = self.snapshot(self.timer)

        with self.assertRaises(KeyError):
            self.edit(recordingtype='invalid')

        self.assertEqual(vars(self.timer), original)
        self.record_timer.timeChanged.assert_not_called()

    def test_sanity_exception_restores_timer_and_autoincrease(self):
        other = self.make_timer(name='Autoincrease', autoincrease=True, end=3000000)
        self.record_timer.timer_list.append(other)
        originals = [self.snapshot(timer) for timer in (self.timer, other)]
        self.sanity.check.side_effect = [False, RuntimeError('Sanity check failed')]
        self.sanity.getSimulTimerList.return_value = [self.timer, other]

        with self.assertRaisesRegex(RuntimeError, 'Sanity check failed'):
            self.edit()

        for timer, original in zip((self.timer, other), originals):
            self.assertEqual(vars(timer), original)
        self.record_timer.timeChanged.assert_not_called()

    def test_timer_not_found_leaves_state_unchanged(self):
        original = self.snapshot(self.timer)

        result = self.edit(beginold=123)

        self.assertFalse(result['result'])
        self.assertEqual(vars(self.timer), original)
        self.namespace['TimerSanityCheck'].assert_not_called()
        self.record_timer.timeChanged.assert_not_called()


if __name__ == '__main__':
    unittest.main()