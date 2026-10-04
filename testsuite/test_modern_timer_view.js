const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const scripts = ['sourcefiles/modern/js/responsive.js', 'plugin/public/modern/js/responsive.min.js'];

function setup(filename, url) {
	const handlers = new Map();
	const requests = [];
	const loads = [];
	const checkbox = {checked: false};
	const $ = selector => {
		if (selector === checkbox) return {is: () => checkbox.checked};
		if (selector === '#content_container') return {
			html() { return this; },
			load(value) { loads.push(value); return this; }
		};
		return {change: handler => handlers.set(selector, handler)};
	};
	$.get = (value, done) => { requests.push({url: value, done}); };
	const context = {$, lastcontenturl: url, loadspinner: 'Loading'};
	vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), context);
	context.WebConfig();
	return {
		context, requests, loads,
		toggle(checked) {
			checkbox.checked = checked;
			handlers.get('#mintimerlist').call(checkbox);
		},
		complete(result = true) {
			assert.equal(typeof requests.at(-1).done, 'function', 'reload must wait for the save response');
			requests.at(-1).done({result});
		}
	};
}

for (const filename of scripts) {
	for (const checked of [true, false]) {
		test(filename + ': compact timer view reloads only after saving ' + checked, () => {
			const ui = setup(filename, 'ajax/timers');
			ui.toggle(checked);
			assert.deepEqual(ui.requests.map(request => request.url), ['api/setwebconfig?mintimerlist=' + (checked ? '1' : '0')]);
			assert.deepEqual(ui.loads, [], 'must not render the previous server setting');
			assert.equal(ui.context.lastcontenturl, 'ajax/timers');
			ui.complete();
			assert.deepEqual(ui.loads, ['ajax/timers']);
			assert.equal(ui.context.lastcontenturl, 'ajax/timers');
		});
	}

	for (const sort of ['name', 'named', 'date', 'dated']) {
		test(filename + ': compact timer view preserves sorting by ' + sort, () => {
			const url = 'ajax/timers?sort=' + sort;
			const ui = setup(filename, url);
			ui.toggle(true);
			assert.deepEqual(ui.loads, []);
			ui.complete();
			assert.deepEqual(ui.loads, [url]);
			assert.equal(ui.context.lastcontenturl, url);
		});
	}

	test(filename + ': failed saves do not reload the timer list', () => {
		const ui = setup(filename, 'ajax/timers');
		ui.toggle(true);
		ui.complete(false);
		assert.deepEqual(ui.loads, []);
	});

	for (const url of ['ajax/movies', 'ajax/multiepg?epgmode=tv', 'ajax/timers-other']) {
		test(filename + ': saving compact timer view does not replace ' + url, () => {
			const ui = setup(filename, 'ajax/timers');
			ui.toggle(true);
			ui.context.lastcontenturl = url;
			ui.complete();
			assert.deepEqual(ui.loads, []);
			assert.equal(ui.context.lastcontenturl, url);
		});
	}

	test(filename + ': saving from another page leaves that page unchanged', () => {
		const ui = setup(filename, 'ajax/movies');
		ui.toggle(false);
		ui.complete();
		assert.deepEqual(ui.loads, []);
		assert.equal(ui.context.lastcontenturl, 'ajax/movies');
	});
}