const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.join(__dirname, '..', 'sourcefiles', 'modern', 'js', 'epgtime.js');
const EpgTime = require(modulePath);

test('now returns epoch seconds without rounding away milliseconds', t => {
	t.mock.method(Date, 'now', () => 1234567890);
	assert.equal(EpgTime.now(), 1234567.89);
});

test('two-hour slots interpolate at and on both sides of their boundaries', () => {
	const start = 10000;
	for (const [elapsed, index, fraction] of [
		[-7200, -1, 0], [-1, -1, 7199 / 7200], [0, 0, 0],
		[3600, 0, 0.5], [7199, 0, 7199 / 7200], [7200, 1, 0],
		[9000, 1, 0.25], [86400, 12, 0]
	]) {
		assert.deepEqual(EpgTime.slot(start + elapsed, start), {index, fraction});
		assert.equal(EpgTime.slotTime(start, index, fraction), start + elapsed);
	}
});

test('timeline positions include the channel column and advance one pixel per six seconds', () => {
	assert.equal(EpgTime.timelinePosition(10000, 10000), 140);
	assert.equal(EpgTime.timelinePosition(9994, 10000), 139);
	assert.equal(EpgTime.timelinePosition(13600, 10000), 740);
	assert.equal(EpgTime.timelinePosition(10003, 10000), 140.5);
});

test('timeline windows exclude the channel column and end before the next visible second', () => {
	assert.deepEqual(EpgTime.timelineWindow(10000, 0, 600), {start: 10000, end: 12759});
	assert.deepEqual(EpgTime.timelineWindow(10000, 600, 600), {start: 13600, end: 16359});
	assert.deepEqual(EpgTime.timelineWindow(10000, 0, 140), {start: 10000, end: 9999});
	assert.deepEqual(EpgTime.timelineWindow(10000, 10, 100), {start: 10060, end: 10059});
	assert.deepEqual(EpgTime.timelineWindow(10000, 0, 0), {start: 10000, end: 9999});
});

test('date conversion, keys, labels and day starts use the local calendar', () => {
	const date = new Date(2026, 9, 1, 18, 30, 15, 250);
	const timestamp = date.getTime() / 1000;
	assert.equal(EpgTime.dateAt(timestamp).getTime(), date.getTime());
	assert.equal(EpgTime.dateKey(date), '2026-10-01');
	assert.equal(EpgTime.dateKey(new Date(2027, 0, 2)), '2027-01-02');
	assert.equal(EpgTime.dayStart(timestamp), new Date(2026, 9, 1).getTime() / 1000);
	assert.equal(EpgTime.formatDate(date, {
		weekdays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
		months: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
	}), 'Do, 1.Okt 2026');
});

test('civil day offsets and local midnight remain correct across Berlin DST transitions', () => {
	const script = `
		const assert = require('node:assert/strict');
		const EpgTime = require(process.argv[1]);
		assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), -60);
		assert.equal(new Date(2026, 6, 1).getTimezoneOffset(), -120);
		for (const [month, day, hours] of [[2, 28, 23], [9, 24, 25]]) {
			const before = new Date(2026, month, day, 12);
			const after = new Date(2026, month, day + 1, 12);
			assert.equal((after - before) / 3600000, hours);
			assert.equal(EpgTime.dayOffset(after, before), 1);
			assert.equal(EpgTime.dayOffset(before, after), -1);
			assert.equal(EpgTime.dayOffset(new Date(2026, month, day + 1, 23), after), 0);
			const midnight = EpgTime.dayStart(after.getTime() / 1000);
			assert.equal(midnight, new Date(2026, month, day + 1).getTime() / 1000);
			assert.equal(EpgTime.dayStart(new Date(2026, month, day + 2, 12).getTime() / 1000) - midnight, hours * 3600);
		}
		assert.equal(EpgTime.dayOffset(new Date(2027, 0, 1), new Date(2026, 11, 31)), 1);
		assert.equal(EpgTime.dayOffset(new Date(2027, 3, 22), new Date(2026, 9, 2)), 202);
	`;
	const result = spawnSync(process.execPath, ['-e', script, modulePath], {
		env: {...process.env, TZ: 'Europe/Berlin'}, encoding: 'utf8', timeout: 10000
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
});