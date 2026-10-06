const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sourcefiles/modern/js/bqe.mjs'), 'utf8');
const template = fs.readFileSync(path.join(root, 'plugin/controllers/views/responsive/ajax/bqe.tmpl'), 'utf8');

function harness(result = [true, 'created']) {
	const requests = [], errors = [], refreshes = [];
	const button = {disabled: false};
	const selection = [{dataset: {sref: '1:7:1:FROM BOUQUET "ÖR & TV.tv"'}}];
	const element = {querySelectorAll: () => [], addEventListener() {}};
	const bql = {querySelectorAll: () => selection};
	const document = {
		forms: {listTypeSelector: {elements: {cType: {value: '2'}, tvRadioMode: {value: '0'}}}},
		getElementById: id => id === 'bql' ? bql : id === 'bqemain' ? {
			querySelectorAll: () => [], querySelector: selector => selector === 'button[name="duplicateBq"]' ? button : element
		} : element,
		createElement: () => element,
		querySelector: () => button,
	};
	const widget = {selectable() {return this;}, sortable() {return this;}, change() {}};
	const context = {
		document, jQuery: () => widget, console: {debug() {}},
		owifRequestUrl: url => url, tstr_error: 'Fehler', tstr_bqe_duplicate_bq: 'Bouquet duplizieren',
		swal: (...args) => errors.push(args),
		fetch: async url => {
			requests.push(new URL(url, 'http://fixture.invalid'));
			if (result instanceof Error) throw result;
			return {ok: true, json: async () => ({Result: result})};
		},
	};
	vm.runInNewContext(source.replace('export const BQE', 'const BQE') + '\nglobalThis.editor = new BQE();', context);
	const editor = context.editor;
	editor.changeTvRadioMode = () => {};
	editor.getBouquets = async () => {refreshes.push('load'); return ['new bouquet'];};
	editor.populateBouquets = data => refreshes.push(data);
	editor.init();
	return {editor, button, selection, requests, errors, refreshes};
}

test('Duplizieren steht zwischen Umbenennen und Löschen und hat einen übersetzten Titel', () => {
	assert.match(template, /name="renameBq"[\s\S]*?name="duplicateBq"[^>]*>\$tstrings\['bqe_duplicate_bq'\][\s\S]*?name="deleteBq"/);
});

test('Der Button dupliziert das ausgewählte Bouquet und lädt die Liste nach Erfolg neu', async () => {
	const h = harness();
	assert.equal(h.button.onclick, h.editor.duplicateBouquet);
	await h.button.onclick();
	assert.equal(h.requests.length, 1);
	assert.equal(h.requests[0].pathname, '/bouqueteditor/api/duplicatebouquet');
	assert.equal(h.requests[0].searchParams.get('sBouquetRef'), h.selection[0].dataset.sref);
	assert.deepEqual(h.refreshes, ['load', ['new bouquet']]);
	assert.equal(h.button.disabled, false);
	assert.equal(h.errors.length, 0);
});

test('Ohne Auswahl wird keine Kopie angelegt', async () => {
	const h = harness();
	h.selection.length = 0;
	await h.button.onclick();
	assert.equal(h.requests.length, 0);
});

test('Doppelklicks während des Kopierens lösen keinen zweiten Auftrag aus', async () => {
	const h = harness();
	const pending = h.button.onclick();
	assert.equal(h.button.disabled, true);
	await h.button.onclick();
	await pending;
	assert.equal(h.requests.length, 1);
	assert.equal(h.button.disabled, false);
});

for (const result of [[false, 'Nicht editierbar'], new Error('offline')]) {
	test(`Fehler beim Kopieren werden angezeigt: ${result}`, async () => {
		const h = harness(result);
		await h.button.onclick();
		assert.equal(h.errors.length, 1);
		assert.equal(h.errors[0][2], 'error');
		assert.equal(h.refreshes.length, 0);
		assert.equal(h.button.disabled, false);
	});
}