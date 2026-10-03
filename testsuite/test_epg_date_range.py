import importlib.util
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'plugin/controllers/views/responsive/ajax/multiepg.tmpl'
DATE_RANGE = ROOT / 'plugin/controllers/views/responsive/ajax/epgdaterange.py'


class EpgDateRangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('epgdaterange', DATE_RANGE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.format_date_range = staticmethod(module.formatEpgDateRange)
        cls.get_date_labels = staticmethod(module.getEpgDateLabels)
        cls.translations = {'day_%d' % day: name for day, name in enumerate(
            ('So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'))}
        cls.translations.update({'month_%02d' % month: name for month, name in enumerate(
            ('Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
             'September', 'Oktober', 'November', 'Dezember'), 1)})

    def timestamp(self, year, month, day, hour=0, minute=0):
        return datetime(year, month, day, hour, minute).timestamp()

    def test_date_row_is_shared_by_both_views_between_navigation_and_bouquets(self):
        template = TEMPLATE.read_text(encoding='utf-8')
        self.assertLess(template.index('</ul>', template.index('<div id="navepg">')),
                        template.index('id="epg-date-range"'))
        self.assertLess(template.index('id="epg-date-range"'), template.index('<div id="bqwrap">'))
        self.assertLess(template.index('id="epg-date-range"'),
                        template.index('#if $mode == 2', template.index('<div id="navepg">')))
        self.assertIn('formatEpgDateRange($slot_start, $tstrings)', template)

    def test_date_row_has_equal_spacing_above_and_below(self):
        template = TEMPLATE.read_text(encoding='utf-8')
        self.assertIn('#navepg > .nav-tabs { margin-bottom: 0; }', template)
        self.assertIn('#epg-date-range { clear: both; font-size: 18px; line-height: 1.4; margin: 12px 4px; }', template)
        self.assertNotIn('<br clear="all">', template)
        self.assertNotIn('id="bqlist" class="nav nav-tabs tab--skinned" style="margin-top: -10px;', template)

    def test_fallback_only_shows_selected_day_until_viewport_is_measured(self):
        self.assertEqual(self.format_date_range(self.timestamp(2026, 10, 1), self.translations), 'Do, 1.Okt 2026')
        self.assertEqual(self.format_date_range(self.timestamp(2026, 10, 1, 18), self.translations), 'Do, 1.Okt 2026')
        self.assertEqual(self.format_date_range(self.timestamp(2026, 12, 31, 18), self.translations), 'Do, 31.Dez 2026')

    def test_client_uses_translated_weekdays_and_months(self):
        labels = self.get_date_labels(self.translations)
        self.assertEqual(labels['weekdays'][4], 'Do')
        self.assertEqual(labels['months'][8:10], ['Sep', 'Okt'])
        self.assertIn('var epgDateLabels = $dumps($getEpgDateLabels($tstrings));', TEMPLATE.read_text(encoding='utf-8'))

    def test_client_refreshes_both_views_after_scroll_resize_and_initial_jump(self):
        template = TEMPLATE.read_text(encoding='utf-8')
        self.assertIn("jQuery('#fulltbl').on('scroll', updateEpgDateRange);", template)
        self.assertIn('fixTableHeight(); updateEpgDateRange();', template)
        self.assertIn('autoJumpTimeline();', template)
        self.assertIn('autoJumpTvGuide();', template)
        self.assertIn('data-begin="${event.begin_timestamp}" data-end="$end"', template)


if __name__ == '__main__':
    unittest.main()