from collections import defaultdict
from pathlib import Path
from types import ModuleType
import unittest
from unittest.mock import patch
import warnings

from Cheetah.Compiler import Compiler
from Cheetah.Template import Template


VIEWS = Path(__file__).resolve().parents[1] / 'plugin/controllers/views'


class CreateIpkTemplateTests(unittest.TestCase):
    def test_all_templates_compile_without_warnings(self):
        for path in sorted(VIEWS.rglob('*.tmpl')):
            with self.subTest(template=str(path.relative_to(VIEWS))), warnings.catch_warnings(record=False):
                warnings.simplefilter('error')
                source = Compiler(source=path.read_text(encoding='utf-8'), moduleName=path.stem).getModuleCode()
                compile(source, str(path.with_suffix('.py')), 'exec')

    def test_restarttwisted_response_stays_empty(self):
        with warnings.catch_warnings(record=False):
            warnings.simplefilter('error')
            template = Template.compile(source=(VIEWS / 'web/restarttwisted.tmpl').read_text(encoding='utf-8'))
            self.assertEqual(str(template()), '')

    def test_epgdialog_line_breaks_in_both_layouts(self):
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str)
        defaults = ModuleType('Plugins.Extensions.OpenWebif.controllers.defaults')
        defaults.showPiconBackground = False
        modules = {module.__name__: module for module in (translations, defaults)}
        event = {
            'sref': '1:0:1:', 'sname': 'Channel', 'title': 'Title', 'id': 1,
            'begin': '20:00', 'end': '21:00', 'date': '04.10.2026', 'duration': 60,
            'picon': '/picon', 'shortdesc': 'Short description',
            'longdesc': 'First\nSecond' + r'\8a' + 'Third',
        }
        context = {'events': [event], 'timers': [], 'at': False, 'extEventInfoProvider': None}
        for setting in ('checked', ''):
            with self.subTest(setting=setting), patch.dict('sys.modules', modules), warnings.catch_warnings(record=False):
                warnings.simplefilter('error')
                defaults.isSettingEnabled = lambda name: setting
                template_source = (VIEWS / 'responsive/ajax/epgdialog.tmpl').read_text(encoding='utf-8')
                template = Template.compile(source=template_source)
                markup = str(template(searchList=[context]))
                self.assertIn('First<br/>Second<br/>Third', markup)
                self.assertNotIn(r'\8a', markup)


if __name__ == '__main__':
    unittest.main()