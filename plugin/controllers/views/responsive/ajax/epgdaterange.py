import time
from datetime import datetime, timedelta


def getEpgTimeContext(slot_start):
	slot_date = datetime(*time.localtime(slot_start)[:3])
	today = datetime(*time.localtime(time.time())[:3])
	return {
		'first': int(time.mktime(slot_date.timetuple())),
		'prime_times': [int(time.mktime(slot_date.replace(hour=hour).timetuple())) for hour in (6, 12, 20)],
		'weekdays': [((today + timedelta(days=offset)).weekday() + 1) % 7 for offset in range(7)],
		'weeks': ['%02d' % (today + timedelta(days=7 * offset)).isocalendar()[1] for offset in range(3)]
	}


def formatEpgDateRange(slot_start, tstrings):
	date = datetime.fromtimestamp(slot_start)
	weekday = tstrings['day_%d' % ((date.weekday() + 1) % 7)]
	month = tstrings['month_%02d' % date.month][:3]
	return '%s, %d.%s %d' % (weekday, date.day, month, date.year)


def getEpgDateLabels(tstrings):
	return {
		'weekdays': [tstrings['day_%d' % day] for day in range(7)],
		'months': [tstrings['month_%02d' % month][:3] for month in range(1, 13)]
	}
