const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const root = join(__dirname, '..', 'plugin', 'public', 'modern', 'js');

test('ausgelieferte Vendor- und OWIF-Bundles starten gemeinsam', () => {
	const window = {location: new URL('http://receiver.local/#at')};
	const context = {
		window,
		document: {querySelectorAll: () => []},
		console: {info() {}, debug() {}},
		URL,
		owifRequestUrl: url => url
	};
	context.self = context;
	runInNewContext(readFileSync(join(root, 'vendors-app.js'), 'utf8'), context);
	runInNewContext(readFileSync(join(root, 'owif-app.js'), 'utf8'), context);
	assert.ok(window.owif, 'owif muss vor responsive.min.js verfügbar sein');
});