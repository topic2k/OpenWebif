import ast
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
import time
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from Cheetah.Template import Template


ROOT = Path(__file__).resolve().parents[1]
VIEWS = ROOT / 'plugin/controllers/views/responsive/ajax'


class MovieSearchControllerTests(unittest.TestCase):
    def setUp(self):
        path = ROOT / 'plugin/controllers/ajax.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        controller = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                          and node.name == 'AjaxController')
        controller.body = [node for node in controller.body if isinstance(node, ast.FunctionDef)
                           and node.name in ('P_movies', 'P_moviesearch')]
        self.setting = SimpleNamespace(value='/movie/', save=Mock())
        self.sort = SimpleNamespace(value='name')
        self.movies = [
            {'eventname': 'Straße & Film', 'description': 'Kurztext', 'descriptionExtended': '', 'recordingtime': 3},
            {'eventname': 'Andere Aufnahme', 'description': 'Film über Tiere', 'descriptionExtended': '', 'recordingtime': 1},
            {'eventname': 'Dokumentation', 'description': '', 'descriptionExtended': 'Ein FILM über Berge', 'recordingtime': 2},
            {'eventname': 'Kein Treffer', 'description': None, 'descriptionExtended': None, 'recordingtime': 4},
        ]
        self.get_list = Mock(side_effect=lambda args, directory: {
            'movies': self.movies[:], 'directory': directory or '/default/',
            'bookmarks': [], 'recursive': b'recursive' in args})
        utilities_path = ROOT / 'plugin/controllers/utilities.py'
        utilities = ast.parse(utilities_path.read_text(encoding='utf-8'))
        functions = [node for node in utilities.body if isinstance(node, ast.FunctionDef)
                     and node.name in ('toBinary', 'toString', 'getUrlArg')]
        namespace = {'BaseController': object, 'getMovieList': self.get_list,
                     'isdir': lambda path: path in ('/movie/', '/movie/Serien/'),
                     'globalVars': SimpleNamespace(transcoding=True),
                     'config': SimpleNamespace(OpenWebif=SimpleNamespace(webcache=SimpleNamespace(
                         moviedir=self.setting, moviesort=self.sort)))}
        exec(compile(ast.Module(body=functions + [controller], type_ignores=[]), str(path), 'exec'), namespace)
        self.controller = namespace['AjaxController']()

    def search(self, text='film', **params):
        args = {key.encode(): [value.encode()] for key, value in params.items()}
        args[b'find'] = [text.encode()]
        request = SimpleNamespace(args=args)
        before = dict(args)
        result = self.controller.P_moviesearch(request)
        self.assertEqual(request.args, before)
        return result

    def test_title_short_and_extended_description_case_insensitive(self):
        result = self.search('  FILM  ')
        self.assertEqual([movie['eventname'] for movie in result['movies']],
                         ['Andere Aufnahme', 'Dokumentation', 'Straße & Film'])
        self.assertEqual(result['search'], 'FILM')
        self.assertTrue(result['transcoding'])
        self.assertEqual(self.get_list.call_args.args[0][b'recursive'], [b'1'])
        self.assertFalse(result['recursive'])

    def test_unicode_casefold_and_literal_special_characters(self):
        self.assertEqual(len(self.search('STRASSE &')['movies']), 1)
        self.assertEqual(self.search('.*')['movies'], [])
        self.assertEqual(self.search('<script>')['movies'], [])

    def test_directory_sort_and_original_view_are_preserved(self):
        self.sort.value = 'dated'
        result = self.search(dirname='/movie/Serien/', recursive='1')
        self.assertEqual(self.get_list.call_args.kwargs['directory'], '/movie/Serien/')
        self.assertEqual([movie['recordingtime'] for movie in result['movies']], [3, 2, 1])
        self.assertEqual(result['sort'], 'dated')
        self.assertTrue(result['recursive'])
        self.setting.save.assert_called_once()

    def test_empty_search_uses_normal_list_without_forcing_recursion(self):
        result = self.search('   ')
        self.assertEqual(len(result['movies']), 4)
        self.assertNotIn(b'recursive', self.get_list.call_args.args[0])
        self.assertEqual(result['search'], '')

    def test_regular_movie_list_behavior_is_unchanged(self):
        args = {b'dirname': [b'/movie/'], b'recursive': [b'1']}
        result = self.controller.P_movies(SimpleNamespace(args=args))
        self.assertEqual(len(result['movies']), 4)
        self.assertEqual(self.get_list.call_args.args[0], args)
        self.assertNotIn('search', result)

    def test_invalid_directory_keeps_existing_fallback(self):
        result = self.search(dirname='/missing/')
        self.assertIsNone(self.get_list.call_args.kwargs['directory'])
        self.assertEqual(result['directory'], '/default/')


class MovieMarkupParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class MovieSearchTemplateTests(unittest.TestCase):
    def render(self, name, compact=False, movies=None, search='Film & "<Suche>"'):
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str, movies='Aufnahmen', search='Suchen',
                                             tag_filter_matches='%d Treffer', tag_filter_clear='Zurücksetzen')
        defaults = ModuleType('Plugins.Extensions.OpenWebif.controllers.defaults')

        def setting(key):
            self.assertEqual(key, 'minmovielist')
            return 'checked' if compact else ''

        defaults.isSettingEnabled = setting
        movie = {'eventname': 'Film "<Titel>" & Straße', 'tags': 'Film_&_Serie',
                 'servicename': 'Sender', 'serviceref': '1:0:1:/movie/A & B/film.ts',
                 'filename': '/movie/A & B/film.ts', 'recordingtime': 1000,
                 'begintime': 'Heute', 'lastseen': 50, 'length': '60', 'filesize_readable': '1 GB',
                 'description': 'Kurz <Text>', 'descriptionExtended': 'Langer <Text>'}
        with patch.dict('sys.modules', {translations.__name__: translations, defaults.__name__: defaults}), \
             patch('builtins._', lambda text: text, create=True):
            template = Template.compile(file=str(VIEWS / (name + '.tmpl')), useCache=False,
                                        cacheCompilationResults=False)
            output = str(template(searchList=[{
                'movies': [movie] if movies is None else movies, 'directory': '/movie/A & B/',
                'bookmarks': [], 'transcoding': False, 'recursive': False, 'search': search, 'time': time}]))
        parser = MovieMarkupParser()
        parser.feed(output)
        return output, parser.elements, movie

    def test_search_form_below_heading_on_both_pages(self):
        for name in ('movies', 'moviesearch'):
            with self.subTest(name=name):
                output, elements, _ = self.render(name)
                forms = [attrs for tag, attrs in elements if tag == 'form' and attrs.get('id') == 'movie-search-form']
                self.assertEqual(len(forms), 1)
                self.assertIn('searchMovies(this)', forms[0]['onsubmit'])
                self.assertEqual(forms[0]['data-directory'], '/movie/A & B/')
                self.assertLess(output.index('Aufnahmen</h2>'), output.index('id="movie-search-form"'))
                self.assertIn('col-xs-12 col-sm-4', output)
                self.assertTrue(any(tag == 'button' and attrs.get('type') == 'submit' for tag, attrs in elements))

    def test_search_variants_render_safe_fields_and_working_actions(self):
        for compact in (False, True):
            with self.subTest(compact=compact):
                output, elements, movie = self.render('moviesearch', compact=compact)
                inputs = [attrs for tag, attrs in elements if tag == 'input' and attrs.get('name') == 'find']
                self.assertEqual(inputs[0]['value'], 'Film & "<Suche>"')
                self.assertIn('1 Treffer', output)
                self.assertIn('data-filter-tags="Film_&amp;_Serie"', output)
                self.assertIn('Film &quot;&lt;Titel&gt;&quot; &amp; Straße', output)
                self.assertNotIn('<Titel>', output)
                self.assertNotIn('<Text>', output)
                self.assertTrue(any(attrs.get('id') == '0' for _, attrs in elements))
                actions = [attrs for _, attrs in elements if 'data-movie-title' in attrs]
                self.assertEqual(len(actions), 2)
                self.assertEqual(actions[0]['data-movie-title'], movie['eventname'])
                self.assertIn('clearMoviesSearch()', output)
                self.assertIn('refreshMoviesView()', output)
                self.assertIn('changeMoviesortSearch(', output)
                self.assertEqual('row-striped' in output, compact)

    def test_no_results_still_shows_search_and_reset(self):
        output, elements, _ = self.render('moviesearch', movies=[])
        self.assertIn('0 Treffer', output)
        self.assertIn('clearMoviesSearch()', output)
        self.assertFalse(any('data-filter-tags' in attrs for _, attrs in elements))


if __name__ == '__main__':
    unittest.main()