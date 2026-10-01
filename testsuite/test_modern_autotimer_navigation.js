const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const main = readFileSync(join(__dirname, '..', 'plugin/controllers/views/responsive/main.tmpl'), 'utf8');
const route = main.match(/function modernDirectlink\(\) \{[\s\S]*?\n\t\}/);
const autoTimer = readFileSync(join(__dirname, '..', 'sourcefiles/modern/js/autotimers.mjs'), 'utf8');

test('modern startup dispatches both initial AutoTimer editor URLs to the AutoTimer view', () => {
	assert.ok(route, 'modern startup router is missing');
	for (const hash of ['#/at/new', '#/at/new?match=Film', '#/at/edit?id=42']) {
		const loaded = [];
		runInNewContext(`${route[0]}; modernDirectlink()`, {
			window: { location: { hash } },
			load_maincontent: url => loaded.push(url),
			directlink: () => loaded.push('legacy fallback'),
		});
		assert.deepEqual(loaded, ['ajax/at'], hash);
	}
	assert.equal((main.match(/modernDirectlink\(\);/g) || []).length, 1, 'startup must load the view only once');
});

test('other modern links still use their existing routes', () => {
	for (const [hash, expected] of [['#tagmanager', 'ajax/tagmanager'], ['#/tagmanager', 'ajax/tagmanager'], ['#at', 'legacy fallback'], ['#timers', 'legacy fallback']]) {
		const loaded = [];
		runInNewContext(`${route[0]}; modernDirectlink()`, {
			window: { location: { hash } },
			load_maincontent: url => loaded.push(url),
			directlink: () => loaded.push('legacy fallback'),
		});
		assert.deepEqual(loaded, [expected], hash);
	}
});

test('creating an AutoTimer from its list opens the editor without reloading the same view', () => {
	assert.ok(autoTimer.includes(`document.querySelector('a[href="/#/at/new"]') || nullEl).onclick = self.createEntry`),
		'the router skips loading ajax/at if the AutoTimer list is already shown');
	const loader = readFileSync(join(__dirname, '..', 'sourcefiles/js/openwebif.js'), 'utf8')
		.match(/function load_maincontent_spin\(url\) \{[\s\S]*?\n\}/);
	assert.ok(loader);
	const loaded = [];
	runInNewContext(`${loader[0]}; load_maincontent_spin('ajax/at')`, {
		lastcontenturl: 'ajax/at',
		$: () => ({html: () => ({load: url => loaded.push(url)})}),
	});
	assert.deepEqual(loaded, [], 'hash changes within the same AutoTimer view do not reload the editor');
});