import os
import tempfile
from pathlib import Path
from sys import modules
from types import ModuleType
import unittest
from unittest.mock import patch
from xml.etree import ElementTree

from plugin.controllers.models.tagmanager import get_known_tags, update_known_tags, get_tag_usage, get_tag_usage_for_session


class TagManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.filename = Path(self.tmp.name) / 'movietags'

    def test_create_rename_delete_and_persistence(self):
        self.assertEqual(get_known_tags(self.filename), [])
        self.assertEqual(update_known_tags('add', 'Film', filename=self.filename), ['Film'])
        self.assertEqual(update_known_tags('add', 'Serie', filename=self.filename), ['Film', 'Serie'])
        self.assertEqual(update_known_tags('rename', 'Film', 'Kino', filename=self.filename), ['Kino', 'Serie'])
        self.assertEqual(get_known_tags(self.filename), ['Kino', 'Serie'])
        self.assertEqual(update_known_tags('delete', 'Serie', filename=self.filename), ['Kino'])
        self.assertEqual(self.filename.read_text(encoding='utf-8'), 'Kino')

    def test_plain_delete_does_not_require_usage_files(self):
        self.filename.write_text('Film\nSerie', encoding='utf-8')
        (Path(self.tmp.name) / 'autotimer.xml').write_text('<broken', encoding='utf-8')
        self.assertEqual(update_known_tags('delete', 'Film', filename=self.filename), ['Serie'])
        self.assertEqual(self.filename.read_text(encoding='utf-8'), 'Serie')

    def test_invalid_operations_leave_file_untouched(self):
        self.filename.write_text('Film\nSerie', encoding='utf-8')
        for action, old, new in [('add', 'Film', None), ('rename', 'Film', 'Serie'),
                                 ('delete', 'Unknown', None), ('rename', 'Film', '',),
                                 ('add', '   ', None), ('add', 'bad\ntag', None),
                                 ('add', 'bad\ttag', None), ('add', 'bad\rtag', None),
                                 ('add', 'bad\x00tag', None), ('add', 'bad\x7ftag', None),
                                 ('add', 'x' * 101, None), ('add', None, None),
                                 ('other', 'X', None)]:
            with self.subTest(action=action, old=old, new=new):
                with self.assertRaises(ValueError):
                    update_known_tags(action, old, new, filename=self.filename)
                self.assertEqual(self.filename.read_text(encoding='utf-8'), 'Film\nSerie')

    def test_openatv_tag_formatting_and_persistence(self):
        for entered, stored in [('  meine  Filme  ', 'meine__Filme'),
                                (' Krimi, Drama ', 'Krimi,_Drama'),
                                ('Ärger & Spaß', 'Ärger_&_Spaß'),
                                ('_Rand_', '_Rand_'), ('film', 'film'), ('Film', 'Film')]:
            with self.subTest(entered=entered):
                tags = update_known_tags('add', entered, filename=self.filename)
                self.assertIn(stored, tags)
                self.assertIn(stored, get_known_tags(self.filename))
        self.assertEqual(self.filename.read_text(encoding='utf-8').splitlines(),
                         ['meine__Filme', 'Krimi,_Drama', 'Ärger_&_Spaß', '_Rand_', 'film', 'Film'])
        update_known_tags('rename', 'meine__Filme', ' meine Serien ', filename=self.filename)
        self.assertIn('meine_Serien', get_known_tags(self.filename))
        update_known_tags('delete', 'meine_Serien', filename=self.filename)
        self.assertNotIn('meine_Serien', get_known_tags(self.filename))

    def test_duplicates_are_checked_after_normalization(self):
        self.filename.write_text('Meine_Filme\nSerie', encoding='utf-8')
        for action, old, new in [('add', ' Meine Filme ', None),
                                 ('rename', 'Serie', 'Meine Filme')]:
            with self.subTest(action=action):
                with self.assertRaisesRegex(ValueError, 'Tag already exists'):
                    update_known_tags(action, old, new, filename=self.filename)
                self.assertEqual(self.filename.read_text(encoding='utf-8'), 'Meine_Filme\nSerie')

    def test_known_tags_are_formatted_like_openatv_on_load(self):
        self.filename.write_text(' Meine Filme \nMeine_Filme\n\n  meine  Serien  ', encoding='utf-8')
        self.assertEqual(get_known_tags(self.filename), ['Meine_Filme', 'meine__Serien'])

    def test_usage_keeps_storage_values_with_underscores_and_commas(self):
        xml = Path(self.tmp.name) / 'autotimer.xml'
        xml.write_text('<autotimer><timer><tag>Meine_Filme</tag><tag>Krimi,_Drama</tag>'
                       '</timer></autotimer>', encoding='utf-8')
        usage = get_tag_usage(['Meine_Filme', 'Krimi,_Drama'],
                              [{'tags': 'Meine_Filme Krimi,_Drama'}],
                              [{'tags': 'Meine_Filme Krimi,_Drama'}], xml)
        for tag in usage:
            self.assertEqual(usage[tag], {'timers': 1, 'movies': 1, 'autotimers': 1})

    def test_usage_for_session_only_scans_requested_tags(self):
        movies = ModuleType('plugin.controllers.models.movies')
        timers = ModuleType('plugin.controllers.models.timers')
        session = object()
        calls = []

        def get_movies(rargs, directory=None):
            calls.append((rargs, directory))
            return {'movies': [{'filename': '/movie/sample.ts', 'tags': 'Alt_Neu'}]}

        def get_timers(received_session):
            self.assertIs(received_session, session)
            return {'timers': [{'tags': 'Alt_Neu Alt_Neu'}]}

        movies.getMovieList = get_movies
        timers.getTimers = get_timers
        with patch.dict(modules, {movies.__name__: movies, timers.__name__: timers}):
            self.assertEqual(get_tag_usage_for_session([], session, ['/movie']), {})
            self.assertEqual(calls, [])
            self.assertEqual(get_tag_usage_for_session(['Alt_Neu'], session, ['/movie']),
                             {'Alt_Neu': {'timers': 1, 'movies': 1, 'autotimers': 0}})
        self.assertEqual(calls, [({b'fields': [b'tags'], b'recursive': [b'1'], b'dirname': [b'/movie']}, '/movie')])

    def test_usage_counts_exact_tags_in_timers_movies_and_autotimers(self):
        xml = Path(self.tmp.name) / 'autotimer.xml'
        xml.write_text('<autotimer><timer><tag>Film</tag><tag>Serie</tag></timer>'
                       '<timer><tag>Film</tag></timer></autotimer>', encoding='utf-8')
        usage = get_tag_usage(['Film', 'Serie', 'Fi'],
                              [{'tags': 'Film Fi'}, {'tags': 'Film'}],
                              [{'tags': 'Serie Film'}, {'tags': 'Film'}], xml)
        self.assertEqual(usage['Film'], {'timers': 2, 'movies': 2, 'autotimers': 2})
        self.assertEqual(usage['Serie'], {'timers': 0, 'movies': 1, 'autotimers': 1})
        self.assertEqual(usage['Fi'], {'timers': 1, 'movies': 0, 'autotimers': 0})

    def test_autotimer_attribute_and_tag_list_are_counted_once_per_timer(self):
        xml = Path(self.tmp.name) / 'autotimer.xml'
        xml.write_text('<autotimer><timer tags="Film Serie"><tags>Film Fi</tags>'
                       '<tag>Film</tag></timer></autotimer>', encoding='utf-8')
        usage = get_tag_usage(['Film', 'Serie', 'Fi'], [], [], xml)
        for tag in usage:
            self.assertEqual(usage[tag]['autotimers'], 1)

    def test_unicode_and_permissions(self):
        self.filename.write_text('Älter', encoding='utf-8')
        if os.name == 'posix':
            os.chmod(self.filename, 0o640)
        self.assertEqual(update_known_tags('rename', 'Älter', 'Übung', filename=self.filename), ['Übung'])
        if os.name == 'posix':
            self.assertEqual(self.filename.stat().st_mode & 0o777, 0o640)

    def test_missing_autotimer_file_has_no_usage_but_corrupt_file_is_not_silent(self):
        xml = Path(self.tmp.name) / 'autotimer.xml'
        self.assertEqual(get_tag_usage(['Film'], [], [], xml)['Film']['autotimers'], 0)
        xml.write_text('<autotimer><timer>', encoding='utf-8')
        with self.assertRaises(ElementTree.ParseError):
            get_tag_usage(['Film'], [], [], xml)


if __name__ == '__main__':
    unittest.main()
