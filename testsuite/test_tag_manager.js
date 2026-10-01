const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const timer = read('plugin/controllers/views/responsive/ajax/timers.tmpl');
const autotimer = read('plugin/controllers/views/responsive/ajax/at.tmpl');
const manager = read('plugin/controllers/views/responsive/ajax/tagmanager.tmpl');
const js = read('sourcefiles/modern/js/tagmanager.js');
const main = read('plugin/controllers/views/responsive/main.tmpl');

test('Das moderne Timer-Menü verweist auf die Stichwort-Verwaltung', () => {
	assert.match(timer, /href="#tagmanager"[^>]*>.*manage_tags/);
	assert.match(main, /hash\.replace\('#\/', '#'\) === '#tagmanager'/);
	assert.match(manager, /id="tagmanager"/);
});

test('Das Timer-Menü passt sich langen übersetzten Beschriftungen an', () => {
	assert.match(timer, /#timerbuttons\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*calc\(100vw - 30px\);/);
	assert.match(timer, /#timerbuttons\s*>\s*li\s*\{[^}]*display:\s*block;/);
	assert.match(timer, /#timerbuttons\s*>\s*li\s*>\s*a\s*\{[^}]*white-space:\s*normal;/);
});

test('Das AutoTimer-Menü oben rechts enthält ausschließlich die Stichwort-Verwaltung', () => {
	const header = autotimer.slice(autotimer.indexOf('<h2 id="configtitle">'), autotimer.indexOf('<div class="body atbody">'));
	assert.match(header, /<ul class="header-dropdown m-r-5">[\s\S]*?<i class="material-icons">more_vert<\/i>/);
	const menu = header.match(/<ul class="dropdown-menu pull-right" id="atbuttons">([\s\S]*?)<\/ul>/);
	assert.ok(menu);
	assert.match(menu[1], /href="#tagmanager"[^>]*>.*\$tstrings\['manage_tags'\]/);
	assert.equal((menu[1].match(/<li\b/g) || []).length, 1);
	assert.match(autotimer, /#atbuttons\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*calc\(100vw - 30px\);/);
	assert.match(autotimer, /#atbuttons\s*>\s*li\s*>\s*a\s*\{[^}]*white-space:\s*normal;/);
});

test('Verwaltungsaktionen verwenden POST und zeigen bekannte Verwendungen an', () => {
	assert.match(js, /url: '\/api\/tagmanager',[\s\S]*?type: 'POST'/);
	for (const action of ['add', 'rename', 'delete']) assert.match(js, new RegExp("submitTag\\('" + action + "'"));
	for (const type of ['timers', 'movies', 'autotimers']) assert.ok(manager.includes("$counts['" + type + "']"));
	assert.match(manager, /tag_usage_note/);
});

test('Verwendung wird als Überschrift und jede belegte Kategorie in einer eigenen Zeile angezeigt', () => {
	const i18n = read('plugin/controllers/i18n.py');
	const de = read('locale/de.po');
	assert.match(i18n, /'tag_usage': _\("Usage"\)/);
	assert.match(de, /msgid "Usage"\s+msgstr "Verwendung"/);
	for (const [type, label] of [['timers', 'tag_timers'], ['movies', 'tag_recordings'], ['autotimers', 'tag_autotimers']]) {
		assert.ok(manager.includes('<div>$tstrings[\'' + label + '\']: $counts[\'' + type + '\']</div>'));
	}
});
