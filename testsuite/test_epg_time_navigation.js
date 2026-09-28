const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');

function jumpToTime(day, startHour = 0) {
	const start = template.indexOf('else if (day > 199)');
	const end = template.indexOf('else if (day > 100)', start);
	assert.ok(start !== -1 && end !== -1);
	const branch = template.slice(start, end);
	const modeStart = branch.indexOf('#if $mode == 1');
	const modeEnd = branch.indexOf('#else', modeStart);
	assert.ok(modeStart !== -1 && modeEnd !== -1);
	const code = branch.slice(modeStart, modeEnd).replace(/^\s*#if.*$/m, '').replaceAll('$slot_start', Math.floor(new Date(2026, 8, 28, startHour).getTime() / 1000));
	const scroller = {
		position: 0,
		offset: () => ({top: 0}),
		scrollTop() { return this.position; },
		animate(value) { this.position = value.scrollTop; }
	};
	const rows = {
		length: 12,
		eq: index => ({
			length: index >= 0 && index < 12 ? 1 : 0,
			offset: () => ({top: 40 + index * 200}),
			outerHeight: () => 200
		})
	};
	const jQuery = selector => {
		if (typeof selector === 'object') return {data: () => Math.floor(new Date(2026, 8, 28, {201: 6, 202: 12, 203: 20}[day]).getTime() / 1000)};
		if (selector === '#fulltbl') return scroller;
		if (selector === '#tbl1body tr') return rows;
		if (selector === '.serviceheader') return {first: () => ({outerHeight: () => 40})};
		throw new Error('Unexpected selector: ' + selector);
	};
	const FixedDate = class extends Date {
		static now() { return new Date(2026, 8, 28, 10, 30).getTime(); }
	};
	vm.runInNewContext('function jump(day) { var d = day - 200; ' + code + '} jump(' + day + ');', {jQuery, Date: FixedDate});
	return scroller.position;
}

function jumpOnTimeline(day) {
	const start = template.indexOf('else if (day > 199)');
	const end = template.indexOf('else if (day > 100)', start);
	const branch = template.slice(start, end);
	const modeStart = branch.indexOf('#else');
	const modeEnd = branch.indexOf('#end if', modeStart);
	assert.ok(modeStart !== -1 && modeEnd !== -1);
	const code = branch.slice(modeStart + '#else'.length, modeEnd);
	const scroller = {animate(value) { this.position = value.scrollLeft; }};
	const jQuery = selector => {
		if (selector === '#fulltbl') return scroller;
		if (selector === '.timetable-now') return {css: () => '450px'};
		throw new Error('Unexpected selector: ' + selector);
	};
	vm.runInNewContext('function jump(day) { var d = day - 200; ' + code + '} jump(' + day + ');', {jQuery});
	return scroller.position;
}

test('Uhrzeit-Auswahl ist auch in der Zeitschrift sichtbar, Jetzt nur für die aktuelle Woche', () => {
	const nav = template.slice(template.indexOf('<div id="navepg">'), template.indexOf('display_mode'));
	assert.ok(nav.indexOf("tstrings['prime_times']") < nav.indexOf('#if $mode == 1'));
	for (const time of ['06:00', '12:00', '20:00']) assert.ok(nav.includes(time));
	for (const day of [201, 202, 203]) assert.match(nav, new RegExp('data-day="' + day + '" data-time="'));
	assert.match(nav, /#if \$day == 0 and \$week == 0\s*<li><div id="pt3"/);
	assert.match(nav, /data-day="200">\$tstrings\['now'\]/);
	assert.match(nav, /#if \$mode == 1\s*<li><div class="plusclick lbl">&nbsp;\$tstrings\['cw'\]/);
});

test('Zeitschrift springt vertikal zu 06:00, 12:00, 20:00 und Jetzt', () => {
	assert.equal(jumpToTime(201), 600);
	assert.equal(jumpToTime(202), 1200);
	assert.equal(jumpToTime(203), 2000);
	assert.equal(jumpToTime(200), 1050);
});

test('Zeitschrift begrenzt vergangene Uhrzeiten vor dem ersten EPG-Slot', () => {
	assert.equal(jumpToTime(201, 10), 0);
	assert.equal(jumpToTime(202, 10), 200);
});

test('Zeitstrahl behält seinen horizontalen Uhrzeit-Sprung', () => {
	assert.equal(jumpOnTimeline(201), 3580);
	assert.equal(jumpOnTimeline(200), 290);
});