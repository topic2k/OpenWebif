import ast
import tempfile
import unittest
from pathlib import Path
from sys import modules
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from xml.etree import ElementTree

from plugin.controllers.models import tagmanager


class TagManagerBackendRenameTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name)
        self.known = self.path / 'movietags'
        self.known.write_text('Alt\nAlte\nNeu', encoding='utf-8')
        self.xml = self.path / 'autotimer.xml'
        self.xml.write_text('<?xml version="1.0" encoding="utf-8"?>\n'
                            '<autotimer><timer tags="Alt Neu Alte"><tags>Alt Neu</tags>'
                            '<tag>Alt</tag><tag>Neu</tag><tag>Alte</tag></timer>'
                            '<timer><tag>Alt</tag></timer></autotimer>', encoding='utf-8')
        self.movie = self.path / 'sample.ts'
        self.meta = self.path / 'sample.ts.meta'
        self.meta.write_text('1:0:1:\nMovie\nDescription\n123\nAlt Neu Alte Alt\nrest\n', encoding='utf-8')
        self.timers = [SimpleNamespace(tags=['Alt', 'Neu', 'Alte', 'Alt']),
                       SimpleNamespace(tags=['Alte'])]
        self.saved = []
        self.rt = SimpleNamespace(timer_list=self.timers[:1], processed_timers=self.timers[1:],
                                  saveTimer=lambda: self.saved.append(True))
        self.session = SimpleNamespace(nav=SimpleNamespace(RecordTimer=self.rt))
        self.movies = ModuleType('plugin.controllers.models.movies')
        self.movies.getMovieList = lambda rargs, directory=None: {'movies': [
            {'filename': str(self.movie), 'tags': 'Alt Neu Alte'}]}
        self.reloads = []
        plugin = ModuleType('Plugins.Extensions.AutoTimer.plugin')
        plugin.autotimer = SimpleNamespace(configMtime=10, readXml=lambda: self.reloads.append(True))
        self.plugins = {'plugin.controllers.models.movies': self.movies,
                        'Plugins': ModuleType('Plugins'),
                        'Plugins.Extensions': ModuleType('Plugins.Extensions'),
                        'Plugins.Extensions.AutoTimer': ModuleType('Plugins.Extensions.AutoTimer'),
                        'Plugins.Extensions.AutoTimer.plugin': plugin}

    def rename(self, new='Frisch'):
        with patch.dict(modules, self.plugins):
            return tagmanager.rename_tag_and_uses('Alt', new, self.session, [str(self.path)],
                                                  filename=self.known, autotimer_file=self.xml)

    def test_rename_persists_all_uses_and_preserves_unrelated_tags(self):
        result = self.rename()
        self.assertEqual(result, {'tags': ['Frisch', 'Alte', 'Neu'],
                                  'updated': {'timers': 1, 'movies': 1, 'autotimers': 2}})
        self.assertEqual(self.meta.read_text(encoding='utf-8').splitlines(),
                         ['1:0:1:', 'Movie', 'Description', '123', 'Frisch Neu Alte', 'rest'])
        self.assertEqual(self.timers[0].tags, ['Frisch', 'Neu', 'Alte'])
        self.assertEqual(self.timers[1].tags, ['Alte'])
        self.assertEqual(self.saved, [True])
        xml = ElementTree.parse(self.xml).getroot()
        first = xml.find('timer')
        self.assertEqual(first.get('tags'), 'Frisch Neu Alte')
        self.assertEqual(first.find('tags').text, 'Frisch Neu')
        self.assertEqual([tag.text for tag in first.findall('tag')], ['Frisch', 'Neu', 'Alte'])
        self.assertEqual(self.reloads, [True])
        self.assertEqual(self.plugins['Plugins.Extensions.AutoTimer.plugin'].autotimer.configMtime, -1)

    def test_missing_movie_metadata_prevents_any_changes(self):
        self.meta.unlink()
        before_xml = self.xml.read_bytes()
        with self.assertRaisesRegex(OSError, 'sample.ts.meta'):
            self.rename()
        self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alt\nAlte\nNeu')
        self.assertEqual(self.xml.read_bytes(), before_xml)
        self.assertEqual(self.timers[0].tags, ['Alt', 'Neu', 'Alte', 'Alt'])

    def test_invalid_or_duplicate_target_prevents_changes(self):
        for new in ('Neu', ''):
            with self.subTest(new=new):
                with self.assertRaises(ValueError):
                    self.rename(new)
                self.assertEqual(self.meta.read_text(encoding='utf-8').splitlines()[4], 'Alt Neu Alte Alt')
                self.assertEqual(self.saved, [])

    def test_timer_save_failure_reports_error_and_restores_in_memory_tags(self):
        def fail():
            raise OSError('disk full')

        self.rt.saveTimer = fail
        with self.assertRaisesRegex(OSError, 'disk full'):
            self.rename()
        self.assertEqual(self.timers[0].tags, ['Alt', 'Neu', 'Alte', 'Alt'])
        self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alt\nAlte\nNeu')

    def test_existing_target_in_uses_is_not_duplicated(self):
        self.timers[0].tags.insert(0, 'Frisch')
        self.meta.write_text('ref\nname\ndesc\ntime\nFrisch Alt Alte Alt\n', encoding='utf-8')
        self.xml.write_text('<autotimer><timer><tag>Frisch</tag><tag>Alt</tag>'
                            '<tags>Frisch Alt Frisch</tags></timer></autotimer>', encoding='utf-8')
        result = self.rename()
        self.assertEqual(result['updated'], {'timers': 1, 'movies': 1, 'autotimers': 1})
        self.assertEqual(self.timers[0].tags, ['Frisch', 'Neu', 'Alte'])
        self.assertEqual(self.meta.read_text(encoding='utf-8').splitlines()[4], 'Frisch Alte')
        timer = ElementTree.parse(self.xml).getroot().find('timer')
        self.assertEqual([tag.text for tag in timer.findall('tag')], ['Frisch'])
        self.assertEqual(timer.find('tags').text, 'Frisch')

    def test_corrupt_xml_preflight_prevents_other_changes(self):
        self.xml.write_text('<autotimer><timer>', encoding='utf-8')
        with self.assertRaises(ElementTree.ParseError):
            self.rename()
        self.assertEqual(self.timers[0].tags, ['Alt', 'Neu', 'Alte', 'Alt'])
        self.assertEqual(self.meta.read_text(encoding='utf-8').splitlines()[4], 'Alt Neu Alte Alt')
        self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alt\nAlte\nNeu')

    def test_no_matches_leave_other_stores_unchanged(self):
        self.meta.write_text('ref\nname\ndesc\ntime\nAlte\n', encoding='utf-8')
        self.movies.getMovieList = lambda rargs, directory=None: {'movies': [
            {'filename': str(self.movie), 'tags': 'Alte'}]}
        self.xml.write_text('<autotimer><timer><tag>Alte</tag></timer></autotimer>', encoding='utf-8')
        self.timers[0].tags = ['Alte']
        before_xml = self.xml.read_bytes()
        self.assertEqual(self.rename()['updated'], {'timers': 0, 'movies': 0, 'autotimers': 0})
        self.assertEqual(self.xml.read_bytes(), before_xml)
        self.assertEqual(self.saved, [])

    def test_nested_recordings_in_overlapping_locations_are_updated_once(self):
        nested = self.path / 'nested'
        nested.mkdir()
        nested_meta = nested / 'second.ts.meta'
        nested_meta.write_text('ref\nname\ndesc\ntime\nAlt Alte\n', encoding='utf-8')
        calls = []

        def get_movies(rargs, directory=None):
            calls.append((rargs, directory))
            return {'movies': [{'filename': str(self.movie), 'tags': 'Alt Neu Alte'},
                               {'filename': str(nested / 'second.ts'), 'tags': 'Alt Alte'}]}

        self.movies.getMovieList = get_movies
        with patch.dict(modules, self.plugins):
            result = tagmanager.rename_tag_and_uses('Alt', 'Frisch', self.session,
                                                    [str(self.path), str(nested)],
                                                    filename=self.known, autotimer_file=self.xml)
        self.assertEqual(result['updated']['movies'], 2)
        self.assertEqual(nested_meta.read_text(encoding='utf-8').splitlines()[4], 'Frisch Alte')
        self.assertEqual([directory for _, directory in calls], [str(self.path), str(nested)])
        self.assertTrue(all(b'recursive' in rargs for rargs, _ in calls))

    def test_explicit_movie_directories_are_passed_as_request_arguments(self):
        other = self.path / 'other'
        other.mkdir()
        other_meta = other / 'special.ts.meta'
        other_meta.write_text('ref\nname\ndesc\ntime\nAlt Alte\n', encoding='utf-8')
        checked = []

        def get_movies(rargs, directory=None):
            # The real getMovieList overwrites `directory` from rargs['dirname'].
            selected = rargs.get(b'dirname', [None])[0]
            checked.append(selected)
            return {'movies': [{'filename': str(other / 'special.ts'), 'tags': 'Alt Alte'}]
                    if selected == str(other).encode('utf-8') else []}

        self.movies.getMovieList = get_movies
        with patch.dict(modules, self.plugins):
            result = tagmanager.rename_tag_and_uses('Alt', 'Frisch', self.session,
                                                    [str(other)], filename=self.known,
                                                    autotimer_file=self.xml)
        self.assertEqual(checked, [str(other).encode('utf-8')])
        self.assertEqual(result['updated']['movies'], 1)
        self.assertEqual(other_meta.read_text(encoding='utf-8').splitlines()[4], 'Frisch Alte')


class TagManagerEndpointTests(unittest.TestCase):
    def test_updateuses_is_explicit_and_response_contains_counts(self):
        source = (Path(__file__).resolve().parents[1] / 'plugin/controllers/web.py').read_text(encoding='utf-8')
        controller = next(node for node in ast.parse(source).body
                          if isinstance(node, ast.ClassDef) and node.name == 'WebController')
        method = next(node for node in controller.body
                      if isinstance(node, ast.FunctionDef) and node.name == 'P_tagmanager')
        code = compile(ast.Module(body=[method], type_ignores=[]), 'web.py', 'exec')
        calls = []

        def basic(*args):
            calls.append(('basic', args))
            return ['Frisch']

        def full(*args):
            calls.append(('full', args))
            return {'tags': ['Frisch'], 'updated': {'timers': 1, 'movies': 2, 'autotimers': 3}}

        scope = {'getUrlArg': lambda request, key: request.args.get(key),
                 'update_known_tags': basic, 'rename_tag_and_uses': full,
                 'get_tag_usage_for_session': lambda *args: {'Frisch': {'timers': 1}},
                 'format_tag': tagmanager.format_tag,
                 'comp_config': SimpleNamespace(movielist=SimpleNamespace(videodirs=SimpleNamespace(value=['/movies'])))}
        exec(code, scope)
        handler = scope['P_tagmanager']
        controller = SimpleNamespace(session=object())
        request = SimpleNamespace(method=b'POST', args={'action': 'rename', 'tag': 'Alt', 'newtag': 'Frisch'})
        self.assertEqual(handler(controller, request),
                         {'result': True, 'tags': ['Frisch'], 'usage': {'timers': 1}})
        self.assertEqual(calls[0][0], 'basic')
        request.args['updateuses'] = '1'
        self.assertEqual(handler(controller, request)['updated'],
                         {'timers': 1, 'movies': 2, 'autotimers': 3})
        self.assertEqual(calls[1][0], 'full')
        request.args['updateuses'] = 'invalid'
        self.assertEqual(handler(controller, request)['result'], False)
        self.assertEqual(len(calls), 2)

        for failure in (ElementTree.ParseError('invalid AutoTimer XML'), RuntimeError('timer save failed')):
            with self.subTest(failure=failure):
                scope['rename_tag_and_uses'] = lambda *args: (_ for _ in ()).throw(failure)
                request.args['updateuses'] = '1'
                self.assertEqual(handler(controller, request), {'result': False, 'message': str(failure)})


if __name__ == '__main__':
    unittest.main()