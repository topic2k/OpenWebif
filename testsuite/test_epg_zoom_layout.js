const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const myepg = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'myepg.tmpl'), 'utf8');
const multiepg = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');

function functionSource(template, name) {
	const start = template.indexOf('function ' + name + '() {');
	assert.notEqual(start, -1, name + ' muss in der modernen Vorlage definiert sein');
	let depth = 0;
	for (let index = template.indexOf('{', start); index < template.length; index++) {
		if (template[index] === '{') depth++;
		if (template[index] === '}' && --depth === 0) return template.slice(start, index + 1);
	}
	throw new Error('Unvollständige Funktion ' + name);
}

function layout(viewport, cardTop, tableTop) {
	const state = {viewport, cardTop, tableTop, cardHeight: 0, tableHeight: 0, tableWidth: 0};
	const card = {
		getBoundingClientRect: () => ({top: state.cardTop, bottom: state.cardTop + state.cardHeight})
	};
	const table = {getBoundingClientRect: () => ({top: state.tableTop})};
	const jQuery = selector => {
		if (selector === '#epgcard') return {
			0: card,
			length: 1,
			height(value) { if (value !== undefined) state.cardHeight = value; return state.cardHeight; }
		};
		if (selector === '#epgcard > .body') return {css: () => '20px', width: () => 820};
		if (selector === '#fulltbl') return {
			0: table,
			length: 1,
			height(value) { state.tableHeight = value; return this; },
			width(value) { state.tableWidth = value; return this; }
		};
		throw new Error('Unerwarteter Selektor: ' + selector);
	};
	const source = functionSource(myepg, 'resizeModernEpgCard') + '\n' + functionSource(multiepg, 'fixTableHeight');
	const context = {jQuery, window: {get innerHeight() { return state.viewport; }}};
	vm.runInNewContext(source, context);
	return {state, resize: () => context.fixTableHeight()};
}

test('EPG-Karte und Tabelle füllen den verfügbaren Platz nach Browser-Zoom in beiden Ansichten', () => {
	for (const mode of ['Zeitschrift', 'Zeitstrahl']) {
		const {state, resize} = layout(900, 120, 370);
		resize();
		assert.equal(state.cardHeight, 760, mode);
		assert.equal(state.tableHeight, 490, mode);
		assert.equal(state.tableWidth, 820, mode);
		state.viewport = 1200;
		state.cardTop = 80;
		state.tableTop = 300;
		resize();
		assert.equal(state.cardHeight, 1100, mode);
		assert.equal(state.tableHeight, 860, mode);
	}
});

test('starker Zoom hält die EPG-Tabelle lesbar statt Navigation und Tabelle zu überlappen', () => {
	const {state, resize} = layout(500, 180, 460);
	resize();
	assert.equal(state.cardHeight, 440);
	assert.equal(state.tableHeight, 140);
});