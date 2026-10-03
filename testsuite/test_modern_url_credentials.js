const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const root = join(__dirname, '..');
const template = readFileSync(join(root, 'plugin/controllers/views/responsive/main.tmpl'), 'utf8');
const owif = readFileSync(join(root, 'sourcefiles/modern/js/owif.js'), 'utf8');
const bouquetEditor = readFileSync(join(root, 'sourcefiles/modern/js/bqe.mjs'), 'utf8');
const responsive = readFileSync(join(root, 'sourcefiles/modern/js/responsive.js'), 'utf8');
const bundledResponsive = readFileSync(join(root, 'plugin/public/modern/js/responsive.min.js'), 'utf8');

function browserContext(address) {
	const location = new URL(address);
	const requests = [];
	const window = {location};
	const context = {
		URL,
		window,
		self: window,
		document: {querySelectorAll: () => []},
		console: {debug() {}, info() {}},
		fetch: async input => {
			const url = new URL(input, location.href);
			if (url.username || url.password) throw new TypeError('Request cannot be constructed from a URL that includes credentials');
			requests.push(url.href);
			return {ok: true, headers: {get: () => 'application/json'}, json: async () => ({tags: ['Serie'], known: ['Serie']})};
		}
	};
	return {context, requests};
}

function installUrlNormalization(context) {
	const bootstrap = template.match(/<script>\s*function owifRequestUrl[\s\S]*?<\/script>/);
	assert.ok(bootstrap, 'URL normalization must be installed before legacy scripts');
	context.$ = {ajaxPrefilter: callback => { context.prefilter = callback; }};
	runInNewContext(bootstrap[0].replace(/^<script>|<\/script>$/g, ''), context);
	return bootstrap[0];
}

test('same-origin API URLs lose inherited credentials; external URLs stay untouched', () => {
	const {context} = browserContext('http://alice:secret@receiver.local/#at');
	const bootstrap = installUrlNormalization(context);
	assert.ok(template.indexOf(bootstrap) < template.indexOf('/js/openwebif.min.js'));
	assert.equal(context.owifRequestUrl('/api/gettags?tag=Serie'), 'http://receiver.local/api/gettags?tag=Serie');
	assert.equal(context.owifRequestUrl('ajax/at'), 'http://receiver.local/ajax/at');
	assert.equal(context.owifRequestUrl('http://alice:secret@receiver.local/api/gettags'), 'http://receiver.local/api/gettags');
	assert.equal(context.owifRequestUrl('https://elsewhere.local/api'), 'https://elsewhere.local/api');
	assert.equal(typeof context.prefilter, 'function');
	const ajaxOptions = {url: 'ajax/at'};
	context.prefilter(ajaxOptions);
	assert.equal(ajaxOptions.url, 'http://receiver.local/ajax/at');
});

for (const address of ['http://alice:secret@receiver.local/#at', 'http://receiver.local/#at']) {
	test(`moderne API-Fetches funktionieren mit ${address.includes('@') ? 'und' : 'ohne'} URL-Zugangsdaten`, async () => {
		const {context, requests} = browserContext(address);
		installUrlNormalization(context);
		runInNewContext(owif.replace("import screenfull from 'screenfull';", ''), context);
		assert.deepEqual(await context.window.owif.api.getTags(), ['Serie']);
		assert.deepEqual(await context.window.owif.utils.fetchData('/api/tagfiltertags'), {tags: ['Serie'], known: ['Serie']});
		assert.deepEqual(requests, [
			'http://receiver.local/api/gettags',
			'http://receiver.local/api/tagfiltertags'
		]);
	});

	test(`Filter zeigt bekannte Stichworte mit ${address.includes('@') ? 'und' : 'ohne'} URL-Zugangsdaten`, async () => {
		const {context, requests} = browserContext(address);
		installUrlNormalization(context);
		const makeNode = () => ({
			children: [],
			replaceChildren() { this.children = []; },
			appendChild(child) { this.children.push(child); },
			append(...children) { this.children.push(...children); },
			prepend(child) { this.children.unshift(child); }
		});
		const panel = {hidden: true};
		const options = makeNode();
		const toggle = {classList: {toggle() {}}, querySelector: () => null, setAttribute() {}};
		const nodes = {
			'.list-tag-filter-panel': panel,
			'.list-tag-filter-options': options,
			'.list-tag-filter-selection': {hidden: true},
			'.list-tag-filter-chips': makeNode(),
			'.list-tag-filter-count': {textContent: ''},
			'.list-tag-filter-clear': {}
		};
		const host = {
			isConnected: true,
			dataset: {known: 'Bekannte Stichworte', used: 'Weitere verwendete Stichworte', matches: '%d', error: 'Abruf fehlgeschlagen'},
			parentElement: {querySelectorAll: () => []},
			querySelector: selector => nodes[selector]
		};
		Object.assign(context.document, {
			getElementById: () => host,
			querySelector: () => toggle,
			addEventListener() {},
			createElement: () => makeNode(),
			createTextNode: text => ({textContent: text})
		});
		runInNewContext(responsive.slice(responsive.indexOf('var listTagFilterSelections'), responsive.indexOf('$(function ()')), context);
		context.initListTagFilter('at');
		await toggle.onclick();
		assert.deepEqual(requests, ['http://receiver.local/api/tagfiltertags']);
		assert.equal(options.children[0].textContent, 'Bekannte Stichworte');
		assert.equal(options.children[1].children[0].value, 'Serie');
	});
}

test('ausgeliefertes Filterskript bereinigt die URL des Stichwortabrufs', () => {
	assert.match(bundledResponsive, /fetch\(owifRequestUrl\(["']\/api\/tagfiltertags["']\)\)/);
});

test('Bouqueteditor sendet Lese- und Schreibaufrufe ohne URL-Zugangsdaten', async () => {
	const {context, requests} = browserContext('http://alice:secret@receiver.local/#bqe');
	installUrlNormalization(context);
	const request = bouquetEditor.slice(bouquetEditor.indexOf('  const apiRequest ='), bouquetEditor.indexOf('  const _serviceTypeMap'));
	runInNewContext(`${request}; this.apiRequest = apiRequest;`, context);
	await context.apiRequest('/api/getservices');
	await context.apiRequest('/bouqueteditor/api/addservice', {method: 'POST'});
	assert.deepEqual(requests, [
		'http://receiver.local/api/getservices',
		'http://receiver.local/bouqueteditor/api/addservice'
	]);
});