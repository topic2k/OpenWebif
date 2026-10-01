const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive');
const main = readFileSync(join(root, 'main.tmpl'), 'utf8');
const editor = readFileSync(join(root, 'ajax', 'bqe.tmpl'), 'utf8');
const autoTimer = readFileSync(join(root, 'ajax', 'at.tmpl'), 'utf8');

test('modern header and bouquet editor use fresh, matching versions of their application scripts', () => {
	const version = main.match(/\/modern\/js\/responsive\.min\.js\?(v[\d.]+)"/)?.[1];
	assert.ok(version, 'responsive script must be cache-busted');
	assert.notEqual(version, 'v1.2.32', 'receiver currently delivers v1.2.32');
	assert.ok(main.includes(`/modern/js/owif-app.js?${version}"`));
	assert.ok(editor.includes(`/modern/js/bouqueteditor-app.js?${version}"`));
	assert.ok(autoTimer.includes(`/modern/js/autotimers-app.js?${version}"`));
});