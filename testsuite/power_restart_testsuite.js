const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../sourcefiles/js/openwebif.js'), 'utf8');
const start = source.indexOf('function start_power_state(');
const end = source.indexOf('function load_reboot_dialog(', start);
assert.ok(start !== -1 && end > start);

function createBrowser(modern = false) {
	const requests = [];
	const dialogs = [];
	const sweetAlerts = [];
	let check;
	let failure;
	let spinner = 0;
	let polling = 0;
	const modal = {
		content: '',
		options: null,
		css: function () { return this; },
		text: function (value) { this.content = value; return this; },
		html: function (value) { this.content = value; return this; },
		dialog: function (options) {
			if (typeof options === 'object') {
				this.options = options;
				dialogs.push({options, content: this.content});
			} else if (options === 'close' && this.options) {
				const previous = this.options;
				this.options = null;
				if (previous.close) previous.close.call(this);
			} else if (options === 'destroy') {
				this.options = null;
			}
			return this;
		}
	};
	const jquery = function (selector) {
		if (selector === '#PowerModal') return {length: modern ? 1 : 0};
		return modal;
	};
	jquery.ajax = function (options) {
		assert.equal(options.url, '/api/powerstatecheck');
		return {
			done: function (callback) { check = callback; return this; },
			fail: function (callback) { failure = callback; return this; }
		};
	};
	const browser = {
		$: jquery,
		window: {confirm: function () { assert.fail('Native confirm used'); }},
		alert: function () { assert.fail('Native alert used'); },
		swal: function (options, callback, type) { sweetAlerts.push({options, callback, type}); },
		loadspinner: "'spinner'",
		tstr_reboot_box: 'Reboot', tstr_restart_gui: 'GUI',
		tstr_cancel: 'Cancel', tstr_close: 'Close',
		tstr_restart_recording_warning: 'Recording',
		tstr_restart_upcoming_warning: 'Upcoming',
		tstr_restart_streaming_warning: 'Streaming',
		tstr_restart_anyway: 'Proceed?',
		tstr_restart_check_failed: 'Check failed',
		setTimeout: function (callback) { callback(); },
		load_reboot_dialog: function () { spinner++; },
		wait_for_openwebif: function () { polling++; },
		webapi_execute: function (url) { requests.push(url); }
	};
	vm.runInNewContext(source.slice(start, end), browser);
	return {
		start: browser.handle_power_state_dialog,
		resolve: function (risks) { check(risks); },
		reject: function () { failure(); },
		requests, dialogs, sweetAlerts,
		get spinner() { return spinner; },
		get polling() { return polling; }
	};
}

for (const modern of [false, true]) {
	function confirm(browser, accepted) {
		if (modern) {
			const alert = browser.sweetAlerts[0];
			assert.equal(alert.options.type, 'warning');
			assert.equal(alert.options.showCancelButton, true);
			assert.equal(alert.options.cancelButtonText, 'Cancel');
			assert.match(alert.options.text, /Recording\nUpcoming\nStreaming\n\nProceed\?/);
			alert.callback(accepted);
		} else {
			const dialog = browser.dialogs[0];
			assert.equal(dialog.options.modal, true);
			assert.match(dialog.content, /Recording\nUpcoming\nStreaming\n\nProceed\?/);
			assert.ok(dialog.options.buttons.Cancel);
			if (accepted) dialog.options.buttons.GUI.call({});
			else dialog.options.buttons.Cancel.call({});
		}
	}

	const active = createBrowser(modern);
	active.start(3);
	active.resolve({recording: true, upcoming: true, streaming: true});
	assert.deepEqual(active.requests, []);
	confirm(active, true);
	assert.deepEqual(active.requests, ['api/powerstate?newstate=3&confirmed=1']);
	assert.equal(active.spinner, 1);
	assert.equal(active.polling, 1);

	const canceled = createBrowser(modern);
	canceled.start(2);
	canceled.resolve({recording: true, upcoming: true, streaming: true});
	if (modern) {
		assert.equal(canceled.sweetAlerts[0].options.confirmButtonText, 'Reboot');
		canceled.sweetAlerts[0].callback(false);
	} else {
		assert.ok(canceled.dialogs[0].options.buttons.Reboot);
		canceled.dialogs[0].options.buttons.Cancel.call({});
	}
	assert.deepEqual(canceled.requests, []);
	assert.equal(canceled.spinner, 0);

	const idle = createBrowser(modern);
	idle.start(2);
	idle.resolve({recording: false, upcoming: false, streaming: false});
	assert.deepEqual(idle.dialogs, []);
	assert.deepEqual(idle.sweetAlerts, []);
	assert.deepEqual(idle.requests, ['api/powerstate?newstate=2']);

	for (const malformed of [false, true]) {
		const failed = createBrowser(modern);
		failed.start(3);
		if (malformed) failed.resolve({result: false});
		else failed.reject();
		assert.deepEqual(failed.requests, []);
		if (modern) {
			assert.equal(failed.sweetAlerts[0].type, 'error');
			assert.equal(failed.sweetAlerts[0].callback, 'Check failed');
		} else {
			assert.equal(failed.dialogs[0].content, 'Check failed');
			assert.ok(failed.dialogs[0].options.buttons.Close);
		}
	}

	const standby = createBrowser(modern);
	standby.start(1);
	assert.deepEqual(standby.requests, ['api/powerstate?newstate=1']);
}

console.log('Power restart browser tests passed');