const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');

function keepVisibleShift(start, end, size, edge) {
	const beginning = template.indexOf('function epgKeepVisibleShift(');
	const ending = template.indexOf('\n}', beginning);
	assert.ok(beginning >= 0 && ending > beginning, 'shared EPG visibility calculation is missing');
	const context = {};
	vm.runInNewContext(template.slice(beginning, ending + 2), context);
	return context.epgKeepVisibleShift(start, end, size, edge);
}

test('Zeitschrift: Sendungsdetails bleiben im freien Platz bis zur nächsten Sendung sichtbar', () => {
	assert.equal(keepVisibleShift(100, 700, 60, 330), 230);
	assert.equal(keepVisibleShift(100, 700, 60, 900), 540);
	assert.equal(keepVisibleShift(100, 300, 60, 330), 140);
	assert.equal(keepVisibleShift(400, 700, 60, 330), 0);
});

test('Zeitstrahl: Text langer Sendungen bleibt sichtbar, ohne über ihr Ende hinauszurutschen', () => {
	assert.equal(keepVisibleShift(-400, 1200, 180, 140), 540);
	assert.equal(keepVisibleShift(-400, 220, 180, 140), 440);
	assert.equal(keepVisibleShift(200, 250, 180, 140), 0);
});

test('beide modernen Ansichten verwenden die begrenzte Verschiebung', () => {
	assert.match(template, /cell\.querySelectorAll\('\.epg__event'\)[\s\S]*?epgKeepVisibleShift\(start, end, event\.offsetHeight, edge\)/);
	assert.match(template, /row\.querySelectorAll\('\.eventlist \.event\[data-begin\]'\)[\s\S]*?epgKeepVisibleShift\(start, eventBounds\.right, info\.offsetWidth, edge\)/);
});

function runScroll(mode) {
	const beginning = template.indexOf('function epgKeepVisibleShift(');
	const ending = template.indexOf('var reloadTimers = false;', beginning);
	const script = template.slice(beginning, ending);
	let update;
	const container = {
		classList: {contains: name => mode === 'guide' && name === 'epg__tv-guide'},
		getBoundingClientRect: () => ({top: 0, bottom: 400, left: 0, right: 600}),
		addEventListener: (name, callback) => { assert.equal(name, 'scroll'); update = callback; }
	};
	let elements;
	if (mode === 'guide') {
		let scroll = 0;
		const first = {
			offsetHeight: 60, style: {},
			getBoundingClientRect() { return {top: -80 - scroll + (this._epgShift || 0)}; }
		};
		const second = {
			offsetHeight: 60, style: {},
			getBoundingClientRect() { return {top: 180 - scroll + (this._epgShift || 0)}; }
		};
		const cell = {
			getBoundingClientRect: () => ({top: -100 - scroll, bottom: 300 - scroll, left: 0, right: 200}),
			querySelectorAll: () => [first, second]
		};
		container.querySelector = () => ({offsetHeight: 40});
		container.querySelectorAll = () => [cell];
		elements = {first, second, setScroll: value => { scroll = value; }};
	} else {
		let scroll = 0;
		const info = {
			offsetWidth: 180, style: {},
			getBoundingClientRect() { return {left: -400 - scroll + (this._epgShift || 0)}; }
		};
		const event = {
			getBoundingClientRect: () => ({left: -400 - scroll, right: 500 - scroll}),
			querySelector: () => info
		};
		const row = {
			getBoundingClientRect: () => ({top: 0, bottom: 60}),
			querySelectorAll: () => [event]
		};
		container.querySelector = () => ({offsetWidth: 140});
		container.querySelectorAll = () => [row];
		elements = {info, setScroll: value => { scroll = value; }};
	}
	const context = {
		document: {getElementById: () => container}, window: {},
		jQuery: () => ({off() { return this; }, on() { return this; }}),
		requestAnimationFrame: callback => callback(), setTimeout: () => {}
	};
	vm.runInNewContext(script, context);
	return {elements, update};
}

test('Zeitschrift: beim Scrollen verdeckt eine Sendung ihre Nachfolger nicht', () => {
	const {elements, update} = runScroll('guide');
	assert.equal(elements.first._epgShift, 120);
	elements.setScroll(120);
	update();
	assert.equal(elements.first._epgShift, 200);
	assert.equal(elements.second._epgShift, 0);
	elements.setScroll(220);
	update();
	assert.equal(elements.second._epgShift, 60);
});

test('Zeitstrahl: Text folgt horizontalem Scrollen und bleibt im Sendungsblock', () => {
	const {elements, update} = runScroll('timeline');
	assert.equal(elements.info._epgShift, 540);
	elements.setScroll(200);
	update();
	assert.equal(elements.info._epgShift, 720);
	elements.setScroll(280);
	update();
	assert.equal(elements.info._epgShift, 720);
	elements.setScroll(0);
	update();
	assert.equal(elements.info._epgShift, 540);
});