const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'sourcefiles/modern/js/responsive.js'), 'utf8');
const spinner = source.slice(source.indexOf('function SetSpinner()'), source.indexOf('\nfunction listTimers('));
const dialog = source.slice(source.indexOf('function load_reboot_dialog('), source.indexOf('\nfunction toggleLeftSideBar('));

function renderDialog(title) {
	let markup;
	const context = {
		tstr_loading: 'Lade',
		$: selector => {
			assert.equal(selector, '#responsivespinner');
			return { html: value => { markup = value; } };
		},
	};
	runInNewContext(spinner + dialog, context);
	context.SetSpinner();
	const original = context.loadspinner;
	context.load_reboot_dialog(original, title);
	return { markup, original, current: context.loadspinner };
}

for (const title of ['Receiver neu starten', 'Benutzeroberfläche neu starten']) {
	test(title + ' zeigt Animation und Hinweis gemeinsam in einer Karte', () => {
		const { markup } = renderDialog(title);
		assert.match(markup, /class=['"]loader card['"]/);
		assert.match(markup, /class=['"]preloader['"]/);
		assert.ok(markup.includes('<p>Lade...</p><p>' + title + '</p>'));
	});
}

test('die Karte verändert keine allgemeinen Ladeanzeigen', () => {
	const { markup, original, current } = renderDialog('Receiver neu starten');
	assert.equal(current, original);
	assert.match(original, /class=['"]loader['"]/);
	assert.ok(!original.includes('loader card'));
	assert.notEqual(markup, original);
});