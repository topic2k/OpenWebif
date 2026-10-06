import base64
import json
from pathlib import Path
import re
import subprocess
import unittest

from testsuite import test_movie_search


ROOT = test_movie_search.ROOT


class RenderedMovieSearchTests(unittest.TestCase):
    def test_search_with_rendered_pages_and_deployed_javascript(self):
        renderer = test_movie_search.MovieSearchTemplateTests()
        term = 'Film "<Titel>" & Straße'
        pages = {'movies': renderer.render('movies', search='')[0],
                 'empty': renderer.render('moviesearch', movies=[], search='kein Treffer')[0]}
        for compact in (False, True):
            pages[str(compact)] = renderer.render('moviesearch', compact=compact, search=term)[0]
            for recursive in (False, True):
                pages[f'movies-{compact}-{recursive}'] = renderer.render(
                    'movies', compact=compact, recursive=recursive, search='')[0]
        paths = ('js/jquery-2.2.4.min.js', 'js/openwebif.min.js', 'modern/js/responsive.min.js',
                 'css/materialicons.min.css',
                 'modern/plugins/bootstrap/css/bootstrap.min.css',
                 'modern/css/style.min.css', 'modern/css/responsive.min.css')
        assets = {'/' + name: ROOT / 'plugin/public' / name for name in paths}
        font = 'fonts/materialicons/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2'
        main = (ROOT / 'plugin/controllers/views/responsive/main.tmpl').read_text(encoding='utf-8')
        data = {'pages': pages, 'term': term, 'directory': '/movie/A & B/',
                'tagFilterStyle': re.search(r'<style>.*?</style>', main, re.DOTALL).group(),
                'assets': {url: path.read_text(encoding='utf-8') for url, path in assets.items()},
                'fonts': {'/' + font: base64.b64encode((ROOT / 'plugin/public' / font).read_bytes()).decode('ascii')}}
        command = ['node', '--test-reporter=tap', str(Path(__file__).with_name('movie_search_browser_tests.js'))]
        result = subprocess.run(command,
                                input=json.dumps(data), text=True, encoding='utf-8',
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout)
        print(result.stdout)


if __name__ == '__main__':
    unittest.main()