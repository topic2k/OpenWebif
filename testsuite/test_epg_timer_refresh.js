const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sourcefiles', 'modern', 'js', 'responsive.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');
const start = source.indexOf('function addTimerEvent(');
const end = source.indexOf('function addTimer(', start);
const saveStart = source.indexOf('function btn_saveTimer(');
const saveEnd = source.indexOf('function WebConfig(', saveStart);
assert.ok(start !== -1 && end !== -1 && saveStart !== -1 && saveEnd !== -1);

function runAddTimer(mode, successful, modalOpen, withCallback = false, form = false, editing = false) {
	const calls = {requests: [], refreshed: [], modal: [], notices: [], conflicts: [], callback: [], api: []};
	const event = (id, marker) => ({
		id, marker,
		getAttribute(name) { return name === 'data-id' ? id : '1:0:1:'; }
	});
	const current = [event('42', null), event('43', null)];
	const fresh = [event('42', mode === 'guide' ? 'timer--record' : 'timer--zap'), event('43', null)];
	const events = items => ({each(fn) { items.forEach(item => fn.call(item)); return this; }});
	const epg = {
		length: 1,
		data: name => name === 'refreshUrl' ? '/ajax/multiepg?bref=bouquet&day=2&epgmode=tv&week=1' : undefined,
		closest: () => ({length: 1}),
		find: () => events(current)
	};
	const $ = selector => {
		if (selector === '#fulltbl') return epg;
		if (selector === '#EventModal') return {hasClass: () => modalOpen};
		if (selector === '<div>') return {append: () => ({find: () => events(fresh)})};
		if (typeof selector === 'object') return {
			clone: () => ({...selector}),
			replaceWith(replacement) {
				selector.marker = replacement.marker;
				calls.refreshed.push(selector.id);
			}
		};
		if (form) return {
			val: () => selector === '#bouquet_select' ? '1:0:1:' : 'value',
			is: filter => filter === ':hidden' || selector === '#enabled',
			each: () => {}
		};
		throw new Error('Unexpected selector: ' + selector);
	};
	$.parseHTML = response => [response];
	$.get = (url, done) => { calls.requests.push(url); done('fresh EPG'); };
	$.ajax = ({url, success}) => { calls.api.push(url); success({result: successful, message: 'failed'}); };
	const context = {
		$, webapi_execute_result: (url, done) => done(successful, successful ? 'added' : 'failed', null),
		showErrorMain: message => calls.notices.push(message),
		loadeventepg: (...args) => calls.modal.push(args),
		TimerConflict: (...args) => calls.conflicts.push(args),
		tstr_timer_added: 'Timer added',
		moment: () => ({unix: () => 12345}),
		timerTagChoices: {getValue: () => ['Film']}, _tags: ['Film'],
		current_serviceref: editing ? '1:0:1:' : '',
		current_begin: 12300,
		current_end: 12400,
		timeredit_begindestroy: false,
		reloadTimers: false
	};
	vm.runInNewContext(source.slice(start, end) + source.slice(saveStart, saveEnd), context);
	if (form) context.btn_saveTimer();
	else context.addTimerEvent('1:0:1:', 42, mode === 'timeline', withCallback ? result => calls.callback.push(result.state) : undefined);
	return {calls, current};
}

for (const mode of ['guide', 'timeline']) {
	test('Timer hinzufügen aktualisiert ' + mode + ' und die geöffneten Sendungsdetails', () => {
		const {calls, current} = runAddTimer(mode, true, true);
		assert.deepEqual(calls.requests, ['/ajax/multiepg?bref=bouquet&day=2&epgmode=tv&week=1']);
		assert.equal(current[0].marker, mode === 'guide' ? 'timer--record' : 'timer--zap');
		assert.deepEqual(calls.modal, [['42', '1:0:1:']].map(([id, ref]) => [Number(id), ref]));
	});
}

test('Fehler verändern weder das EPG noch das Popup', () => {
	const {calls, current} = runAddTimer('guide', false, true);
	assert.deepEqual(calls.requests, []);
	assert.equal(current[0].marker, null);
	assert.deepEqual(calls.modal, []);
});

test('Erfolgreicher Callback aktualisiert das EPG auch bei geschlossenem Popup', () => {
	const {calls, current} = runAddTimer('guide', true, false, true);
	assert.equal(current[0].marker, 'timer--record');
	assert.deepEqual(calls.callback, [true]);
	assert.deepEqual(calls.modal, []);
});

for (const mode of ['guide', 'timeline']) {
	test('Hinzufügen & Timer bearbeiten aktualisiert nach Speichern ' + mode, () => {
		const {calls, current} = runAddTimer(mode, true, false, false, true);
		assert.deepEqual(calls.api, ['/api/timeradd?']);
		assert.deepEqual(calls.requests, ['/ajax/multiepg?bref=bouquet&day=2&epgmode=tv&week=1']);
		assert.equal(current[0].marker, mode === 'guide' ? 'timer--record' : 'timer--zap');
	});
}

test('Fehlgeschlagenes Speichern aktualisiert keine EPG-Markierung', () => {
	const {calls, current} = runAddTimer('guide', false, false, false, true);
	assert.deepEqual(calls.api, ['/api/timeradd?']);
	assert.deepEqual(calls.requests, []);
	assert.equal(current[0].marker, null);
});

test('Erfolgreiche Timer-Bearbeitung aktualisiert ebenfalls das EPG', () => {
	const {calls, current} = runAddTimer('guide', true, false, false, true, true);
	assert.deepEqual(calls.api, ['api/timerchange?']);
	assert.equal(current[0].marker, 'timer--record');
});

test('Beide Ansichten bieten dieselbe Aktualisierungsadresse', () => {
	assert.ok(/<div id="fulltbl"[^>]*data-refresh-url="ajax\/multiepg\?bref=.*&amp;day=\$day&amp;epgmode=\$epgmode&amp;week=\$week"/g.test(template));
	assert.equal((template.match(/data-refresh-url="ajax\/multiepg\?/g) || []).length, 2);
});