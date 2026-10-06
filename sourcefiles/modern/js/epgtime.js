(function(root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.EpgTime = factory();
})(typeof window !== 'undefined' ? window : globalThis, function() {
	var slotSeconds = 7200;
	var secondsPerPixel = 6;
	var channelWidth = 140;
	var guideSecondsPerPixel = 15;

	function now() {
		return Date.now() / 1000;
	}
	function dateAt(timestamp) {
		return new Date(timestamp * 1000);
	}
	function dayStart(timestamp) {
		var date = dateAt(timestamp);
		date.setHours(0, 0, 0, 0);
		return date.getTime() / 1000;
	}
	function slot(timestamp, start) {
		var elapsed = timestamp - start;
		var index = Math.floor(elapsed / slotSeconds);
		return {index: index, fraction: (elapsed - index * slotSeconds) / slotSeconds};
	}
	function slotTime(start, index, fraction) {
		return start + (index + fraction) * slotSeconds;
	}
	function interval(begin, end, start, finish, scale) {
		if (![begin, end, start, finish, scale].every(isFinite) || scale <= 0 || end <= begin) return null;
		var visibleStart = Math.max(begin, start);
		var visibleEnd = Math.min(end, finish);
		if (visibleEnd <= visibleStart) return null;
		return {start: visibleStart, end: visibleEnd, offset: (visibleStart - start) / scale, length: (visibleEnd - visibleStart) / scale};
	}
	function guidePosition(timestamp, start) {
		return (timestamp - start) / guideSecondsPerPixel;
	}
	function timelinePosition(timestamp, first) {
		return channelWidth + (timestamp - first) / secondsPerPixel;
	}
	function timelineWindow(first, left, width, finish) {
		var start = first + left * secondsPerPixel;
		var end = start + Math.max(0, width - channelWidth) * secondsPerPixel;
		if (typeof finish === 'number' && isFinite(finish)) {
			start = Math.max(first, start);
			end = Math.min(end, finish);
			if (end <= start) return null;
		}
		return {start: start, end: end - 1};
	}
	function dayOffset(selected, today) {
		return Math.round((Date.UTC(selected.getFullYear(), selected.getMonth(), selected.getDate()) -
			Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
	}
	function dateKey(date) {
		return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
	}
	function formatDate(date, labels) {
		return labels.weekdays[date.getDay()] + ', ' + date.getDate() + '.' + labels.months[date.getMonth()] + ' ' + date.getFullYear();
	}
	return {now: now, dateAt: dateAt, dayStart: dayStart, slot: slot, slotTime: slotTime,
		interval: interval, guidePosition: guidePosition, guideSecondsPerPixel: guideSecondsPerPixel,
		timelinePosition: timelinePosition, timelineWindow: timelineWindow, dayOffset: dayOffset,
		dateKey: dateKey, formatDate: formatDate};
});