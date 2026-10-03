const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'sourcefiles/modern/js/responsive.js'), 'utf8');
const autoTimer = fs.readFileSync(path.join(root, 'sourcefiles/modern/js/autotimers.mjs'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'plugin/controllers/views/responsive/main.tmpl'), 'utf8');
const templates = ['movies', 'timers', 'at'].map(name => fs.readFileSync(
	path.join(root, 'plugin/controllers/views/responsive/ajax', name + '.tmpl'), 'utf8'));

test('Einzelne und mehrere Tags treffen exakt und mit Oder-Verknüpfung', () => {
	const start = script.indexOf('function tagFilterMatches(');
	const end = script.indexOf('function initListTagFilter(', start);
	const context = {};
	vm.runInNewContext(script.slice(start, end), context);
	assert.equal(context.tagFilterMatches(['Krimi', 'Doku'], []), true);
	assert.equal(context.tagFilterMatches(['Krimi', 'Doku'], ['Doku']), true);
	assert.equal(context.tagFilterMatches(['Krimi', 'Doku'], ['Sport', 'Krimi']), true);
	assert.equal(context.tagFilterMatches(['Krimi', 'Doku'], ['Sport', 'Film']), false);
	assert.equal(context.tagFilterMatches(['Kriminal'], ['Krimi']), false);
	assert.equal(context.tagFilterMatches([], ['Krimi']), false);
});

test('Alle modernen Listen bieten Tag-Auswahl ohne Freitext und verwenden ihre echten Tags', () => {
	for (const [index, name] of ['movies', 'timers', 'at'].entries()) {
		assert.match(templates[index], new RegExp('id="tag-filter-' + name + '"'));
		assert.match(templates[index], new RegExp('data-tag-filter-toggle="' + name + '"'));
		assert.match(templates[index], /list-tag-filter-item/);
		assert.doesNotMatch(templates[index], /list-tag-filter-search/);
	}
	assert.match(templates[0], /data-filter-tags="\$escape\(\$movie\.tags/);
	assert.match(templates[1], /data-filter-tags="\$escape\(\$timer\.tags/);
	assert.match(autoTimer, /newNode\.dataset\.filterTags = atItem\.tag\.join\(' '\)/);
	assert.match(autoTimer, /window\.initListTagFilter\('at'\)/);
	assert.match(script, /fetch\(owifRequestUrl\('\/api\/tagfiltertags'\)\)/);
});

test('Die drei Filter-Buttons zeigen ausschließlich das zustandsabhängige Icon', () => {
	for (const template of templates) {
		const button = template.match(/<button[^>]+class="list-tag-filter-toggle"[^>]*>[\s\S]*?<\/button>/);
		assert.ok(button);
		assert.match(button[0], /aria-label="\$tstrings\['tag_filter_title'\]"/);
		assert.match(button[0], /data-icon="ic:round-filter-alt-off"/);
		assert.match(button[0], /data-icon="ic:round-filter-alt"[^>]*hidden/);
		assert.doesNotMatch(button[0], /tag_filter_choose|list-tag-filter-badge/);
	}
	assert.match(script, /querySelector\('\.list-tag-filter-icon--off'\)\?\.toggleAttribute\('hidden', !!selected\.length\)/);
	assert.match(script, /querySelector\('\.list-tag-filter-icon--on'\)\?\.toggleAttribute\('hidden', !selected\.length\)/);
	assert.match(styles, /\.list-tag-filter-toolbar \{[^}]*display: flex;[^}]*align-items: center/);
	assert.match(styles, /\.list-tag-filter-options label \{[^}]*font-weight: normal/);
});

test('Ein fehlgeschlagener Abruf bekannter Tags sperrt weder AutoTimer-Neuanlage noch Filter', async () => {
	const {AutoTimersApp} = await import('data:text/javascript;base64,' + Buffer.from(autoTimer).toString('base64'));
	const previous = {window: globalThis.window, document: globalThis.document, owif: globalThis.owif};
	let created = false;
	let listShown = false;
	let newAction;
	const openedFilters = [];
	try {
		globalThis.window = {location: {hash: '#/at'}, initListTagFilter: kind => openedFilters.push(kind)};
		globalThis.document = {querySelector: () => ({})};
		globalThis.owif = {
			api: {getAllServices: async () => ({channels: [], bouquets: []}), getTags: async () => { throw new Error('Keine Stichworte'); }},
			gui: {preparedChoices: () => ({})}
		};
		const app = new AutoTimersApp();
		app.populateList = () => { listShown = true; };
		app.populateForm = () => { created = true; };
		app.initEventHandlers = () => { newAction = app.createEntry; };
		await app.init();
		newAction();
		assert.equal(created, true);
		assert.equal(listShown, true);
		assert.deepEqual(openedFilters, ['at']);
		assert.deepEqual(app.availableTags, []);
		globalThis.window.initListTagFilter = () => { throw new Error('Veraltete Filter-Vorlage'); };
		globalThis.window.location.hash = '#/at/new';
		await app.init();
		assert.equal(created, true);
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete globalThis[name];
			else globalThis[name] = value;
		}
	}
});

test('AutoTimer-Filter öffnet das Popup und zeigt bekannte sowie verwendete Stichworte', async () => {
	const makeNode = () => ({children: [], replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); }, prepend(child) { this.children.unshift(child); }});
	const options = makeNode();
	const chips = makeNode();
	const panel = {hidden: true};
	const selection = {hidden: true};
	const count = {textContent: ''};
	const clear = {};
	const icons = {'off': {}, 'on': {}};
	for (const icon of Object.values(icons)) icon.toggleAttribute = (attribute, state) => { icon[attribute] = state; };
	const toggle = {
		classList: {toggle() {}},
		querySelector: selector => selector.endsWith('--off') ? icons.off : icons.on,
		setAttribute(name, value) { this[name] = value; }
	};
	const host = {
		dataset: {known: 'Bekannte Stichworte', used: 'Weitere verwendete Stichworte', matches: '%d Treffer'},
		isConnected: true,
		parentElement: {querySelectorAll: () => []},
		querySelector: selector => ({'.list-tag-filter-panel': panel, '.list-tag-filter-options': options, '.list-tag-filter-selection': selection, '.list-tag-filter-chips': chips, '.list-tag-filter-count': count, '.list-tag-filter-clear': clear})[selector]
	};
	const document = {
		getElementById: () => host,
		querySelector: () => toggle,
		addEventListener() {},
		createElement: () => makeNode(),
		createTextNode: text => ({textContent: text})
	};
	const context = {document, owifRequestUrl: url => url, fetch: async () => ({ok: true, json: async () => ({known: ['Serie'], used: ['Archiv']})})};
	vm.runInNewContext(script.slice(script.indexOf('var listTagFilterSelections'), script.indexOf('$(function ()')), context);
	context.initListTagFilter('at');
	await toggle.onclick();
	assert.equal(panel.hidden, false);
	assert.equal(toggle['aria-expanded'], 'true');
	assert.deepEqual(options.children.filter(node => node.textContent && !node.children.length).map(node => node.textContent), ['Bekannte Stichworte', 'Weitere verwendete Stichworte']);
	const checkbox = options.children[1].children[0];
	checkbox.checked = true;
	checkbox.onchange();
	assert.equal(icons.off.hidden, true);
	assert.equal(icons.on.hidden, false);
	await toggle.onclick();
	assert.equal(panel.hidden, true);
	toggle.querySelector = () => null;
	context.initListTagFilter('at');
	await toggle.onclick();
	assert.equal(panel.hidden, false);
	assert.equal(options.children[1].children[0].value, 'Serie');
});

test('Ein Klick neben der Auswahlliste schließt sie, ein Klick darauf oder auf den Button nicht', () => {
	const start = script.indexOf('function closeListTagFilterOnOutsideClick(');
	assert.notEqual(start, -1);
	const end = script.indexOf('function initListTagFilter(', start);
	const panel = {hidden: false, contains: target => target === 'panel'};
	const toggle = {contains: target => target === 'toggle', setAttribute(name, value) {
		this[name] = value;
	}};
	const host = {dataset: {list: 'movies'}};
	panel.closest = () => host;
	const document = {
		querySelectorAll: () => [panel],
		querySelector: () => toggle
	};
	const context = {document};
	vm.runInNewContext(script.slice(start, end), context);
	context.closeListTagFilterOnOutsideClick({target: 'panel'});
	assert.equal(panel.hidden, false);
	context.closeListTagFilterOnOutsideClick({target: 'toggle'});
	assert.equal(panel.hidden, false);
	context.closeListTagFilterOnOutsideClick({target: 'outside'});
	assert.equal(panel.hidden, true);
	assert.equal(toggle['aria-expanded'], 'false');
});