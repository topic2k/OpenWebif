const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const script = readFileSync(join(__dirname, '..', 'sourcefiles/modern/js/responsive.js'), 'utf8');
const statusHandler = script.slice(script.indexOf('getStatusInfo = function(){'), script.indexOf('\nfunction setOSD('));

test('modern header polls the receiver even if the browser reports offline', async () => {
	const calls = [];
	const state = {};
	const $ = selector => ({
		toggle: value => { state[selector] = value; },
		html: value => { state[selector] = value; },
		text: value => ({parent: () => ({show: () => { state[selector] = value; }})}),
		hide: () => { state[selector] = false; },
		toggleClass: () => {},
	});
	const status = {
		currservice_station: 'Sender', currservice_name: 'Sendung', isRecording: 'true',
		Recording_list: '\nSender: Sendung\n', isStreaming: 'false', muted: false,
	};
	const context = { $, navigator: { onLine: false }, owif: { api: { getStatusInfo: () => {
		calls.push('status');
		return Promise.resolve(status);
	} } }, setOSD: data => { state.osd = data; } };
	runInNewContext(statusHandler + '\ngetStatusInfo();', context);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(calls, ['status']);
	assert.equal(state.osd, status);
	assert.equal(state['#osd__active-recordings .label-count'], 1);
	assert.equal(state['#osd__connection'], false);
});

test('modern header reports failed status requests instead of skipping retries', async () => {
	const state = {};
	const $ = selector => ({ show: () => { state[selector] = true; } });
	const context = { $, owif: { api: { getStatusInfo: () => Promise.reject(Error('receiver unavailable')) } } };
	runInNewContext(statusHandler + '\ngetStatusInfo();', context);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(state['#osd__connection'], true);
});

test('modern status polling starts before optional page setup', () => {
	const startup = script.slice(script.indexOf('$(function () {'), script.indexOf('\nfunction initJsTranslationAddon('));
	assert.ok(startup.indexOf('getStatusInfo();') < startup.indexOf("$('#editTimerForm').load"));
	assert.ok(startup.indexOf('setInterval(getStatusInfo, 3000);') < startup.indexOf('WebConfig();'));
});