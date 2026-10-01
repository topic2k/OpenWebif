from datetime import datetime


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