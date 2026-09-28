const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');

function jumpFunction(name, next) {
	const start = template.indexOf('function ' + name + '() {');
	const end = template.indexOf(next, start);
	assert.ok(start !== -1 && end !== -1);
	return template.slice(start, end).replace(/^\s*#(?:if|end if).*$/gm, '');
}

function runGuide(hour, minute, enabled = true, startHour = 0) {
	const scroller = {
		length: 1,
		offset: () => ({top: 0}),
		scrollTop(value) {
			if (value !== undefined) this.position = value;
			return this.position || 0;
		},
		height: () => 400
	};
	const row = index => ({
		length: 1,
		offset: () => ({top: 40 + index * 200}),
		outerHeight: () => 200,
		find: () => ({each: () => {}})
	});
	const $ = selector => {
		if (selector === '#fulltbl') return scroller;
		if (selector === '.serviceheader') return {first: () => ({outerHeight: () => 40})};
		if (selector === '#tbl1body') return {find: () => ({eq: row})};
		throw new Error('Unexpected selector: ' + selector);
	};
	const FixedDate = class extends Date {
		constructor() { super(2026, 8, 28, hour, minute); }
		static now() { return new FixedDate().getTime(); }
	};
	const context = {jQuery: $, Date: FixedDate, epgJumpNow: enabled, epgJumpActiveService: false};
	const slotStart = Math.floor(new Date(2026, 8, 28, startHour).getTime() / 1000);
	vm.runInNewContext(jumpFunction('autoJumpTvGuide', 'function autoJumpTimeline').replace('$slot_start', slotStart), context);
	context.autoJumpTvGuide();
	return scroller.position || 0;
}

function runTimeline(marker, eventStart, enabled = true) {
	const scroller = {
		scrollLeft(value) {
			if (value !== undefined) this.position = value;
			return this.position || 0;
		},
		width: () => 600
	};
	const currentEvent = eventStart == null ? {length: 0} : {
		length: 1,
		position: () => ({left: eventStart})
	};
	const row = {length: 1, find: () => ({first: () => ({closest: () => currentEvent})})};
	const $ = selector => {
		if (selector === '#fulltbl') return scroller;
		if (selector === '.epg__row') return {first: () => row};
		if (selector === '.curevent') return {first: () => ({closest: () => currentEvent})};
		if (selector === '.timetable-now') return {css: () => marker + 'px'};
		if (selector === '.epg__channel-col') return {first: () => ({outerWidth: () => 140})};
		throw new Error('Unexpected selector: ' + selector);
	};
	const context = {jQuery: $, epgJumpNow: enabled, epgJumpActiveService: false};
	vm.runInNewContext(jumpFunction('autoJumpTimeline', 'setTimeout(function() {'), context);
	context.autoJumpTimeline();
	return scroller.position || 0;
}

test('Zeitschrift platziert die Uhrzeit bei 30 % des sichtbaren Zeitbereichs', () => {
	assert.equal(runGuide(11, 0), 992);
	assert.equal(runGuide(11, 45), 1067);
	assert.equal(runGuide(15, 30, true, 10), 442);
	assert.equal(runGuide(0, 30), 0);
	assert.equal(runGuide(9, 0, true, 10), 0);
});

test('Zeitstrahl platziert die aktuelle Zeit bei 30 % statt am Beginn einer laufenden Sendung', () => {
	assert.equal(runTimeline(900, 300), 622);
	assert.equal(runTimeline(900, null), 622);
});

test('Bei ausgeschalteter Option bleibt die Startposition unverändert', () => {
	assert.equal(runGuide(11, 0, false), 0);
	assert.equal(runTimeline(900, 300, false), 0);
});