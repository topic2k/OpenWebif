import ast
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import patch


CONTROL = Path(__file__).resolve().parents[1] / 'plugin/controllers/models/control.py'
WEB = Path(__file__).resolve().parents[1] / 'plugin/controllers/web.py'


class PowerRestartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = ast.parse(CONTROL.read_text(encoding='utf-8'))
        functions = [node for node in source.body if isinstance(node, ast.FunctionDef)
                     and node.name in ('getPowerStateRisks', 'setPowerState')]
        cls.namespace = {'time': lambda: 1000, 'GetStreamInfo': lambda: []}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(CONTROL), 'exec'), cls.namespace)

    def session(self, recordings=(), next_recording=-1):
        nav = SimpleNamespace(getRecordings=lambda: recordings,
                              RecordTimer=SimpleNamespace(getNextRecordingTime=lambda: next_recording))
        return SimpleNamespace(nav=nav)

    def test_active_recording(self):
        risks = self.namespace['getPowerStateRisks'](self.session(recordings=['recording']))
        self.assertTrue(risks['recording'])
        self.assertFalse(risks['upcoming'])

    def test_upcoming_recording_window(self):
        for seconds, expected in ((0, True), (359, True), (360, False), (600, False), (-10, False)):
            with self.subTest(seconds=seconds):
                risks = self.namespace['getPowerStateRisks'](self.session(next_recording=1000 + seconds))
                self.assertEqual(risks['upcoming'], expected)

    def test_streaming(self):
        with patch.dict(self.namespace, GetStreamInfo=lambda: [{'ip': '192.0.2.1'}]):
            risks = self.namespace['getPowerStateRisks'](self.session())
        self.assertTrue(risks['streaming'])

    def test_only_explicit_confirmation_skips_receiver_question(self):
        standby = ModuleType('Screens.Standby')
        standby.Standby = object()
        standby.TryQuitMainloop = object()
        standby.inStandby = None
        screen = SimpleNamespace(connected=True, close=lambda value: closed.append(value))
        opened = []
        closed = []
        session = SimpleNamespace(open=lambda *args: opened.append(args) or screen)
        with patch.dict(sys.modules, {'Screens': ModuleType('Screens'), 'Screens.Standby': standby}):
            self.namespace['setPowerState'](session, 2)
            self.assertEqual(closed, [])
            self.namespace['setPowerState'](session, 3, confirmed=True)
            self.assertEqual(closed, [True])
            self.assertEqual(opened, [(standby.TryQuitMainloop, 2), (standby.TryQuitMainloop, 3)])

    def test_no_double_confirmation_when_receiver_already_quits(self):
        standby = ModuleType('Screens.Standby')
        standby.Standby = object()
        standby.TryQuitMainloop = object()
        standby.inStandby = None
        session = SimpleNamespace(open=lambda *args: SimpleNamespace(connected=False, close=lambda _: self.fail('closed twice')))
        with patch.dict(sys.modules, {'Screens': ModuleType('Screens'), 'Screens.Standby': standby}):
            self.namespace['setPowerState'](session, 3, confirmed=True)

    def test_api_requires_explicit_confirmation_flag(self):
        web = ast.parse(WEB.read_text(encoding='utf-8'))
        controller = next(node for node in web.body if isinstance(node, ast.ClassDef) and node.name == 'WebController')
        methods = [node for node in controller.body if isinstance(node, ast.FunctionDef)
                   and node.name in ('P_powerstate', 'P_powerstatecheck')]
        calls = []
        namespace = {
            'getUrlArg': lambda request, name: request.values.get(name),
            'setPowerState': lambda session, state, confirmed=False: calls.append((state, confirmed)),
            'getPowerStateRisks': lambda session: {'recording': True}
        }
        exec(compile(ast.Module(body=methods, type_ignores=[]), str(WEB), 'exec'), namespace)
        session = object()
        controller = SimpleNamespace(session=session)
        self.assertEqual(namespace['P_powerstatecheck'](controller, None), {'recording': True})
        for flag, expected in ((None, False), ('0', False), ('true', False), ('1', True)):
            with self.subTest(flag=flag):
                request = SimpleNamespace(args={}, values={'newstate': '3', 'confirmed': flag})
                namespace['P_powerstate'](controller, request)
                self.assertEqual(calls[-1], ('3', expected))


if __name__ == '__main__':
    unittest.main()