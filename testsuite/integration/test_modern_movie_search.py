import json
from pathlib import Path
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
        paths = ('js/jquery-2.2.4.min.js', 'modern/js/responsive.min.js',
                 'modern/plugins/bootstrap/css/bootstrap.min.css',
                 'modern/css/style.min.css', 'modern/css/responsive.min.css')
        assets = {'/' + name: ROOT / 'plugin/public' / name for name in paths}
        data = {'pages': pages, 'term': term, 'directory': '/movie/A & B/',
                'assets': {url: path.read_text(encoding='utf-8') for url, path in assets.items()}}
        command = ['node', '--test-reporter=tap', str(Path(__file__).with_name('movie_search_browser_tests.js'))]
        result = subprocess.run(command,
                                input=json.dumps(data), text=True, encoding='utf-8',
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout)
        print(result.stdout)


if __name__ == '__main__':
    unittest.main()