const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'plugin/controllers/views/responsive/main.tmpl'), 'utf8');

test('Die Seitenleiste verlinkt die Stichwort-Verwaltung direkt nach dem Bouquet-Editor', () => {
	const sidebar = main.slice(main.indexOf('id="leftsidebar"'), main.indexOf('<!-- #END# Left Sidebar -->'));
	assert.match(sidebar, /href="#bqe"[\s\S]*?<\/li>\s*<li>\s*<a href="#tagmanager" data-close="true">[\s\S]*?\$tstrings\['manage_tags'\][\s\S]*?<\/li>\s*<li>\s*<a href="#satfinder"/);
});