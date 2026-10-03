from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from types import ModuleType
import time
import unittest
from unittest.mock import patch

from Cheetah.Template import Template


class TagTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.labels = []
        self.in_label = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr' and 'data-tag' in attrs:
            self.tags.append(attrs['data-tag'])
        if tag == 'td' and attrs.get('class') == 'tagmanager-label':
            self.labels.append('')
            self.in_label = True
        if tag == 'script':
            self.scripts.append(attrs)

    def handle_endtag(self, tag):
        if tag == 'td':
            self.in_label = False

    def handle_data(self, data):
        if self.in_label:
            self.labels[-1] += data


class FilterItemParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'data-filter-tags' in attrs:
            self.items.append(attrs)


class TagManagerTemplateTests(unittest.TestCase):
    def test_modern_tag_filter_templates_compile(self):
        folder = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax'
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str)
        defaults = ModuleType('Plugins.Extensions.OpenWebif.controllers.defaults')
        defaults.isSettingEnabled = lambda name: ''
        with patch.dict('sys.modules', {translations.__name__: translations, defaults.__name__: defaults}):
            for name in ('movies', 'timers', 'at'):
                with self.subTest(name=name):
                    Template.compile(source=(folder / (name + '.tmpl')).read_text(encoding='utf-8'))

    def test_timer_filter_tag_attribute_preserves_special_characters(self):
        folder = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax'
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str)
        defaults = ModuleType('Plugins.Extensions.OpenWebif.controllers.defaults')
        defaults.isSettingEnabled = lambda name: ''
        timer = {'serviceref': '1:0:1', 'name': 'Film', 'tags': 'Krimi,_Drama A_"B"_<script>&',
                 'begin': 1, 'end': 2, 'disabled': False, 'state': 0, 'justplay': 0,
                 'servicename': 'Sender', 'realbegin': 'Heute', 'realend': 'Morgen',
                 'duration': 60, 'repeated': 0, 'description': 'Beschreibung'}
        with patch.dict('sys.modules', {translations.__name__: translations, defaults.__name__: defaults}):
            for compact in (False, True):
                with self.subTest(compact=compact):
                    defaults.isSettingEnabled = lambda name: 'checked' if compact else ''
                    rendered = str(Template(file=str(folder / 'timers.tmpl'),
                                            searchList=[{'timers': [timer], 'compacttimerlist': compact,
                                                         'time': time}]))
                    parser = FilterItemParser()
                    parser.feed(rendered)
                    self.assertEqual(len(parser.items), 1)
                    self.assertEqual(parser.items[0]['data-filter-tags'], timer['tags'])
                    self.assertNotIn('data-filter-tags="Krimi,_Drama A_"B"_', rendered)

    def test_movie_filter_tag_attribute_preserves_special_characters(self):
        folder = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax'
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str)
        defaults = ModuleType('Plugins.Extensions.OpenWebif.controllers.defaults')
        defaults.isSettingEnabled = lambda name: ''
        movie = {'eventname': 'Film', 'tags': 'Krimi,_Drama A_"B"_<script>&',
                 'servicename': 'Sender', 'serviceref': '1:0:1', 'filename': '/movie/a.ts',
                 'recordingtime': 1000, 'lastseen': 0, 'length': '1:00',
                 'filesize_readable': '1 GB', 'description': 'Beschreibung', 'descriptionExtended': ''}
        with patch.dict('sys.modules', {translations.__name__: translations, defaults.__name__: defaults}), \
             patch('builtins._', lambda text: text, create=True):
            rendered = str(Template(file=str(folder / 'movies.tmpl'),
                                    searchList=[{'movies': [movie], 'directory': '/movie/',
                                                 'bookmarks': [], 'transcoding': False,
                                                 'time': time}]))
        parser = FilterItemParser()
        parser.feed(rendered)
        self.assertEqual(len(parser.items), 1)
        self.assertEqual(parser.items[0]['data-filter-tags'], movie['tags'])
        self.assertNotIn('data-filter-tags="Krimi,_Drama A_"B"_', rendered)

    def test_delete_dialog_has_three_distinct_actions(self):
        filename = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax/tagmanager.tmpl'
        template = filename.read_text(encoding='utf-8')
        self.assertIn('id="tagmanager-delete-dialog"', template)
        self.assertIn('id="tagmanager-delete-name"', template)
        self.assertIn('id="tagmanager-delete-confirm"', template)
        self.assertIn('id="tagmanager-delete-update"', template)
        self.assertIn('id="tagmanager-delete-error"', template)
        self.assertIn("$tstrings['tag_delete_update']", template)
        self.assertIn("$tstrings['cancel']", template)

    def test_rename_dialog_has_three_distinct_actions(self):
        filename = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax/tagmanager.tmpl'
        template = filename.read_text(encoding='utf-8')
        self.assertIn('id="tagmanager-rename"', template)
        self.assertIn('id="tagmanager-rename-form"', template)
        self.assertIn('id="tagmanager-rename-name"', template)
        self.assertIn('id="tagmanager-rename-update"', template)
        self.assertIn("$tstrings['cancel']", template)
        self.assertIn("$tstrings['tag_rename_update']", template)

    def test_display_labels_are_separate_from_escaped_storage_values(self):
        filename = Path(__file__).resolve().parents[1] / 'plugin/controllers/views/responsive/ajax/tagmanager.tmpl'
        tags = ['Meine__Filme', '_Rand_', 'Krimi,_Drama', 'A_"B"_<script>alert(1)</script>&']
        translations = ModuleType('Plugins.Extensions.OpenWebif.controllers.i18n')
        translations.tstrings = defaultdict(str)
        usage = {tag: {'timers': 3, 'movies': 0, 'autotimers': 1} for tag in tags}
        with patch.dict('sys.modules', {translations.__name__: translations}):
            rendered = str(Template(file=str(filename), searchList=[{'tags': tags, 'usage': usage}]))
        parser = TagTableParser()
        parser.feed(rendered)
        self.assertEqual(parser.tags, tags)
        self.assertEqual(parser.labels, [tag.replace('_', ' ') for tag in tags])
        self.assertEqual(len(parser.scripts), 2)
        self.assertEqual(rendered.count('<div>: 3</div>'), len(tags))
        self.assertEqual(rendered.count('<div>: 1</div>'), len(tags))


if __name__ == '__main__':
    unittest.main()