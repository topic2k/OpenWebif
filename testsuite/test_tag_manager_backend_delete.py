import ast
import tempfile
import unittest
from pathlib import Path
from sys import modules
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from xml.etree import ElementTree

from plugin.controllers.models import tagmanager


class TagManagerBackendDeleteTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name)
        self.known = self.path / 'movietags'
        self.known.write_text('Alt\nAlte\nNeu', encoding='utf-8')
        self.xml = self.path / 'autotimer.xml'
        self.xml.write_text('<?xml version="1.0" encoding="utf-8"?>\n'
                            '<autotimer><timer tags="Alt Neu Alte Alt"><tags>Alt Neu Alt</tags>'
                            '<tag>Alt</tag><tag>Neu</tag><tag>Alt</tag><tag>Alte</tag></timer>'
                            '<timer><tag>Alte</tag></timer><timer><tag>Alt</tag></timer>'
                            '</autotimer>', encoding='utf-8')
        self.movie = self.path / 'sample.ts'
        self.meta = self.path / 'sample.ts.meta'
        self.meta.write_bytes(b'ref\r\nname\r\ndesc\r\ntime\r\nAlt Neu Alte Alt\r\nrest\r\n')
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

    def delete(self, locations=None):
        with patch.dict(modules, self.plugins):
            return tagmanager.delete_tag_and_uses('Alt', self.session,
                                                  locations if locations is not None else [str(self.path)],
                                                  filename=self.known, autotimer_file=self.xml)

    def test_delete_removes_only_exact_uses_and_counts_entries(self):
        result = self.delete()
        self.assertEqual(result, {'tags': ['Alte', 'Neu'],
                                  'updated': {'timers': 1, 'movies': 1, 'autotimers': 2}})
        self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alte\nNeu')
        self.assertEqual(self.timers[0].tags, ['Neu', 'Alte'])
        self.assertEqual(self.timers[1].tags, ['Alte'])
        self.assertEqual(self.saved, [True])
        self.assertEqual(self.meta.read_bytes(), b'ref\r\nname\r\ndesc\r\ntime\r\nNeu Alte\r\nrest\r\n')
        root = ElementTree.parse(self.xml).getroot()
        first = root.find('timer')
        self.assertEqual(first.get('tags'), 'Neu Alte')
        self.assertEqual(first.find('tags').text, 'Neu')
        self.assertEqual([tag.text for tag in first.findall('tag')], ['Neu', 'Alte'])
        self.assertEqual([tag.text for tag in root.findall('timer')[2].findall('tag')], [])
        self.assertEqual(self.reloads, [True])
        self.assertEqual(self.plugins['Plugins.Extensions.AutoTimer.plugin'].autotimer.configMtime, -1)

    def test_overlapping_recursive_locations_update_each_recording_once(self):
        nested = self.path / 'nested'
        nested.mkdir()
        meta = nested / 'second.ts.meta'
        meta.write_text('ref\nname\ndesc\ntime\nAlt Alte\n', encoding='utf-8')
        calls = []

        def get_movies(rargs, directory=None):
            calls.append((rargs, directory))
            return {'movies': [{'filename': str(self.movie), 'tags': 'Alt Neu'},
                               {'filename': str(nested / 'second.ts'), 'tags': 'Alt Alte'}]}

        self.movies.getMovieList = get_movies
        self.assertEqual(self.delete([str(self.path), str(nested)])['updated']['movies'], 2)
        self.assertEqual(meta.read_text(encoding='utf-8').splitlines()[4], 'Alte')
        self.assertEqual([directory for _, directory in calls], [str(self.path), str(nested)])
        self.assertTrue(all(args[b'recursive'] == [b'1'] and args[b'dirname'] == [directory.encode('utf-8')]
                            for args, directory in calls))

    def test_missing_metadata_or_invalid_xml_prevents_all_changes(self):
        for bad_metadata in (True, False):
            with self.subTest(bad_metadata=bad_metadata):
                if bad_metadata:
                    self.meta.unlink()
                else:
                    self.xml.write_text('<autotimer><timer>', encoding='utf-8')
                with self.assertRaises((OSError, ElementTree.ParseError)):
                    self.delete()
                self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alt\nAlte\nNeu')
                self.assertEqual(self.timers[0].tags, ['Alt', 'Neu', 'Alte', 'Alt'])
                self.assertEqual(self.saved, [])
                if bad_metadata:
                    self.meta.write_text('ref\nname\ndesc\ntime\nAlt Neu\n', encoding='utf-8')

    def test_invalid_tag_and_inconsistent_movie_metadata_prevent_changes(self):
        with self.assertRaisesRegex(ValueError, 'Tag not found'):
            with patch.dict(modules, self.plugins):
                tagmanager.delete_tag_and_uses('Unknown', self.session, [str(self.path)],
                                               filename=self.known, autotimer_file=self.xml)
        for content in ('ref\nname\ndesc\ntime\n', 'ref\nname\ndesc\ntime\nAlte Neu\n'):
            with self.subTest(content=content):
                self.meta.write_text(content, encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'Recording'):
                    self.delete()
                self.assertEqual(self.saved, [])
                self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alt\nAlte\nNeu')
                self.assertEqual(self.timers[0].tags, ['Alt', 'Neu', 'Alte', 'Alt'])

    def test_missing_autotimer_file_still_updates_other_uses(self):
        self.xml.unlink()
        result = self.delete()
        self.assertEqual(result['updated'], {'timers': 1, 'movies': 1, 'autotimers': 0})
        self.assertEqual(self.reloads, [])
        self.assertFalse(self.xml.exists())

    def test_timer_save_failure_restores_tags_without_touching_files(self):
        before = self.meta.read_bytes(), self.xml.read_bytes()
        self.rt.saveTimer = lambda: (_ for _ in ()).throw(OSError('disk full'))
        with self.assertRaisesRegex(OSError, 'disk full'):
            self.delete()
        self.assertEqual(self.timers[0].tags, ['Alt', 'Neu', 'Alte', 'Alt'])
        self.assertEqual((self.meta.read_bytes(), self.xml.read_bytes()), before)
        self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alt\nAlte\nNeu')

    def test_late_file_failure_reports_partial_change(self):
        original = tagmanager._write_atomic

        def fail_known(filename, content):
            if filename == self.known:
                raise OSError('disk full')
            return original(filename, content)

        with patch.object(tagmanager, '_write_atomic', side_effect=fail_known):
            with self.assertRaisesRegex(OSError, 'Tag delete incomplete; some uses may already be updated: disk full'):
                self.delete()
        self.assertEqual(self.known.read_text(encoding='utf-8'), 'Alt\nAlte\nNeu')
        self.assertEqual(self.timers[0].tags, ['Neu', 'Alte'])

    def test_no_matches_leave_other_stores_unchanged(self):
        self.meta.write_text('ref\nname\ndesc\ntime\nAlte\n', encoding='utf-8')
        self.movies.getMovieList = lambda rargs, directory=None: {'movies': [
            {'filename': str(self.movie), 'tags': 'Alte'}]}
        self.xml.write_text('<autotimer><timer><tag>Alte</tag></timer></autotimer>', encoding='utf-8')
        self.timers[0].tags = ['Alte']
        before = self.meta.read_bytes(), self.xml.read_bytes()
        self.assertEqual(self.delete()['updated'], {'timers': 0, 'movies': 0, 'autotimers': 0})
        self.assertEqual((self.meta.read_bytes(), self.xml.read_bytes()), before)
        self.assertEqual(self.saved, [])
        self.assertEqual(self.reloads, [])


class TagManagerDeleteEndpointTests(unittest.TestCase):
    def test_delete_updateuses_is_explicit_and_reports_counts(self):
        source = (Path(__file__).resolve().parents[1] / 'plugin/controllers/web.py').read_text(encoding='utf-8')
        controller = next(node for node in ast.parse(source).body
                          if isinstance(node, ast.ClassDef) and node.name == 'WebController')
        method = next(node for node in controller.body
                      if isinstance(node, ast.FunctionDef) and node.name == 'P_tagmanager')
        scope = {'getUrlArg': lambda request, key: request.args.get(key),
                 'update_known_tags': lambda *args: ['Alte', 'Neu'],
                 'rename_tag_and_uses': lambda *args: None,
                 'get_tag_usage_for_session': lambda *args: None,
                 'format_tag': tagmanager.format_tag,
                 'comp_config': SimpleNamespace(movielist=SimpleNamespace(videodirs=SimpleNamespace(value=['/movies'])))}
        calls = []

        def delete(*args):
            calls.append(args)
            return {'tags': ['Alte', 'Neu'], 'updated': {'timers': 1, 'movies': 2, 'autotimers': 3}}

        scope['delete_tag_and_uses'] = delete
        code = compile(ast.Module(body=[method], type_ignores=[]), 'web.py', 'exec')
        exec(code, scope)
        handler = scope['P_tagmanager']
        request = SimpleNamespace(method=b'POST', args={'action': 'delete', 'tag': 'Alt'})
        context = SimpleNamespace(session=object())
        self.assertEqual(handler(context, request), {'result': True, 'tags': ['Alte', 'Neu'], 'usage': None})
        self.assertEqual(calls, [])
        request.args['updateuses'] = '1'
        self.assertEqual(handler(context, request),
                         {'result': True, 'tags': ['Alte', 'Neu'], 'usage': None,
                          'updated': {'timers': 1, 'movies': 2, 'autotimers': 3}})
        self.assertEqual(calls, [('Alt', context.session, ['/movies'])])
        request.args['updateuses'] = 'invalid'
        self.assertEqual(handler(context, request), {'result': False, 'message': 'Invalid updateuses option'})
        request.args['action'] = 'add'
        request.args['updateuses'] = '1'
        self.assertEqual(handler(context, request), {'result': False, 'message': 'Invalid updateuses option'})
        self.assertEqual(len(calls), 1)
        request.args['action'] = 'delete'
        scope['delete_tag_and_uses'] = lambda *args: (_ for _ in ()).throw(OSError('disk full'))
        self.assertEqual(handler(context, request), {'result': False, 'message': 'disk full'})


if __name__ == '__main__':
    unittest.main()