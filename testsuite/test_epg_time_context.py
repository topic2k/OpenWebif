import importlib.util
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
	'epgdaterange',
	Path(__file__).resolve().parents[1].joinpath('plugin', 'controllers', 'views', 'responsive', 'ajax', 'epgdaterange.py')
)
epgdaterange = importlib.util.module_from_spec(spec)
spec.loader.exec_module(epgdaterange)


def timestamp(year, month, day, hour=0, minute=0):
	return int(datetime(year, month, day, hour, minute, tzinfo=timezone.utc).timestamp())


class LocalClock:
	def __init__(self, offset, transition=None, next_offset=None):
		self.offset = offset
		self.transition = transition
		self.next_offset = next_offset

	def offset_at(self, value):
		if self.transition is not None and value >= self.transition:
			return self.next_offset
		return self.offset

	def localtime(self, value):
		date = datetime.fromtimestamp(value, timezone.utc) + timedelta(seconds=self.offset_at(value))
		return time.struct_time(date.timetuple()[:8] + (-1,))

	def mktime(self, value):
		local = datetime(*value[:6], tzinfo=timezone.utc).timestamp()
		for offset in (self.offset, self.next_offset):
			if offset is not None and self.offset_at(local - offset) == offset:
				return local - offset
		raise ValueError('Nonexistent local time')


class EpgTimeContextTests(unittest.TestCase):
	def context(self, now, slot_start, clock=None):
		clock = clock or LocalClock(0)
		with patch('time.time', return_value=now) as mocked_time:
			with patch('time.localtime', side_effect=clock.localtime), patch('time.mktime', side_effect=clock.mktime):
				result = epgdaterange.getEpgTimeContext(slot_start)
			mocked_time.assert_called_once_with()
		return result

	def test_navigation_across_iso_week_and_year_boundaries(self):
		for now, weekdays, weeks in (
			(timestamp(2020, 12, 31, 23), [4, 5, 6, 0, 1, 2, 3], ['53', '01', '02']),
			(timestamp(2021, 1, 1, 1), [5, 6, 0, 1, 2, 3, 4], ['53', '01', '02']),
			(timestamp(2024, 12, 31, 23), [2, 3, 4, 5, 6, 0, 1], ['01', '02', '03'])
		):
			with self.subTest(now=now):
				result = self.context(now, timestamp(2026, 7, 15, 14))
				self.assertEqual(result['weekdays'], weekdays)
				self.assertEqual(result['weeks'], weeks)

	def test_midnight_and_prime_times_use_offset_slot_not_today(self):
		result = self.context(timestamp(2026, 2, 2, 10), timestamp(2026, 1, 31, 23))
		self.assertEqual(set(result), {'first', 'prime_times', 'weekdays', 'weeks'})
		self.assertEqual(result['first'], timestamp(2026, 1, 31))
		self.assertEqual(result['prime_times'], [timestamp(2026, 1, 31, hour) for hour in (6, 12, 20)])
		self.assertEqual(result['weekdays'], [1, 2, 3, 4, 5, 6, 0])
		self.assertEqual(result['weeks'], ['06', '07', '08'])
		for value in [result['first']] + result['prime_times']:
			self.assertIs(type(value), int)

	def test_local_date_and_prime_times_with_non_integer_hour_offset(self):
		result = self.context(
			timestamp(2025, 12, 31, 20), timestamp(2025, 12, 31, 19), LocalClock(19800)
		)
		self.assertEqual(result['first'], timestamp(2025, 12, 31, 18, 30))
		self.assertEqual(result['prime_times'], [
			timestamp(2026, 1, 1, 0, 30), timestamp(2026, 1, 1, 6, 30), timestamp(2026, 1, 1, 14, 30)
		])
		self.assertEqual(result['weekdays'], [4, 5, 6, 0, 1, 2, 3])
		self.assertEqual(result['weeks'], ['01', '02', '03'])

	def test_spring_dst_uses_local_calendar_days_and_prime_times(self):
		clock = LocalClock(3600, timestamp(2026, 3, 29, 1), 7200)
		result = self.context(timestamp(2026, 3, 28, 22, 30), timestamp(2026, 3, 29, 10), clock)
		self.assertEqual(result['first'], timestamp(2026, 3, 28, 23))
		self.assertEqual(result['prime_times'], [timestamp(2026, 3, 29, hour) for hour in (4, 10, 18)])
		self.assertEqual(result['weekdays'], [6, 0, 1, 2, 3, 4, 5])
		self.assertEqual(result['weeks'], ['13', '14', '15'])
		result = self.context(timestamp(2026, 3, 28, 23, 30), timestamp(2026, 3, 29, 10), clock)
		self.assertEqual(result['weekdays'], [0, 1, 2, 3, 4, 5, 6])
		self.assertEqual(result['weeks'], ['13', '14', '15'])

	def test_autumn_dst_uses_local_calendar_days_and_prime_times(self):
		clock = LocalClock(7200, timestamp(2026, 10, 25, 1), 3600)
		result = self.context(timestamp(2026, 10, 23, 22, 30), timestamp(2026, 10, 25, 11), clock)
		self.assertEqual(result['first'], timestamp(2026, 10, 24, 22))
		self.assertEqual(result['prime_times'], [timestamp(2026, 10, 25, hour) for hour in (5, 11, 19)])
		self.assertEqual(result['weekdays'], [6, 0, 1, 2, 3, 4, 5])
		self.assertEqual(result['weeks'], ['43', '44', '45'])
		result = self.context(timestamp(2026, 10, 18, 22, 30), timestamp(2026, 10, 25, 11), clock)
		self.assertEqual(result['weekdays'], [1, 2, 3, 4, 5, 6, 0])
		self.assertEqual(result['weeks'], ['43', '44', '45'])

	def test_existing_date_apis_are_unchanged(self):
		strings = {'day_%d' % day: 'day%d' % day for day in range(7)}
		strings.update({'month_%02d' % month: 'month%02d' % month for month in range(1, 13)})
		slot_start = time.mktime((2021, 1, 3, 12, 0, 0, 0, 0, -1))
		self.assertEqual(epgdaterange.formatEpgDateRange(slot_start, strings), 'day0, 3.mon 2021')
		self.assertEqual(epgdaterange.getEpgDateLabels(strings), {
			'weekdays': ['day%d' % day for day in range(7)],
			'months': ['mon'] * 12
		})


if __name__ == '__main__':
	unittest.main()
