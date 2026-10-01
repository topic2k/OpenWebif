const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sourcefiles/modern/js/responsive.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'plugin/controllers/views/responsive/ajax/edittimer.tmpl'), 'utf8');
const main = fs.readFileSync(path.join(root, 'plugin/controllers/views/responsive/main.tmpl'), 'utf8');

test('Das moderne Timer-Popup bietet eine Choices-Mehrfachauswahl für Tags', () => {
	assert.match(template, /<select[^>]*id="tagsnew"[^>]*multiple[^>]*>/);
	assert.ok(main.indexOf('/modern/plugins/choices/choices.min.js') !== -1);
	assert.ok(main.indexOf('/modern/plugins/choices/choices.min.js') < main.indexOf('/modern/js/responsive.min.js'));
});

test('Das Tag-Feld liegt außerhalb des Beschreibungsfelds im Timer-Popup', () => {
	const description = template.indexOf('<textarea');
	const tags = template.indexOf('id="tagsnew"', description);
	assert.ok(description !== -1 && tags > description);
	assert.ok(/<textarea\b[^>]*\bid="description"[^>]*><\/textarea>/.test(template.slice(description, tags)));
});

test('Die Tag-Liste liegt außerhalb des scrollbaren und animierten Dialogs', () => {
	assert.match(main, /<div id="TimerModal"[\s\S]*?<div class="modal-dialog">[\s\S]*?<\/div>\s*<div id="timer-tag-overlay"><\/div>\s*<\/div>/);
	assert.doesNotMatch(template, /timer-tags-open \.modal-dialog|transform:\s*none\s*!important/);
	assert.match(template, /#TimerModal #timer-tag-overlay \.choices__list--dropdown\s*\{[^}]*position:\s*fixed/);
});

test('Das Tag-Dropdown überlagert den Timer-Editor ohne ihn zu vergrößern und endet spätestens bei 90 Prozent der Fensterhöhe', () => {
	assert.match(template, /#TimerModal #timer-tag-overlay \.choices__list--dropdown\s*\{[^}]*position:\s*fixed/);
	assert.match(source, /addEventListener\('showDropdown'/);
	assert.match(source, /addEventListener\('hideDropdown'/);
	const start = source.indexOf('function positionTimerTagDropdown(');
	const end = source.indexOf('function initTimerTags(', start);
	assert.ok(start !== -1 && end > start);
	const list = {scrollHeight: 300, style: {}};
	const dropdown = {style: {}, classList: {add() {}, remove() {}}, querySelector: () => list};
	let top = 810;
	const choices = {getBoundingClientRect: () => ({top: top - 45, bottom: top, left: 240, width: 570})};
	const body = {
		clientHeight: 720, scrollHeight: 1320, scrollTop: 100,
		getBoundingClientRect: () => ({top: 75})
	};
	const content = {style: {}};
	const classes = new Set(['timer-tags-open']);
	const modal = {classList: {contains: name => classes.has(name), remove: name => classes.delete(name)}};
	const document = {
		getElementById: id => id === 'TimerModal' ? modal : content,
		querySelector: selector => selector === '#timer-tag-overlay .choices__list--dropdown' ? dropdown : choices
	};
	const context = {document, window: {innerHeight: 1000}};
	vm.runInNewContext(source.slice(start, end), context);
	context.positionTimerTagDropdown();
	assert.equal(content.style.paddingBottom, undefined);
	assert.equal(body.scrollTop, 100);
	assert.equal(dropdown.style.top, '465px');
	assert.equal(dropdown.style.left, '240px');
	assert.equal(dropdown.style.width, '570px');
	assert.equal(dropdown.style.maxHeight, '300px');
	assert.equal(list.style.maxHeight, '300px');
	context.window.innerHeight = 700;
	context.positionTimerTagDropdown();
	assert.equal(dropdown.style.maxHeight, '0px');
	assert.equal(body.scrollTop, 100);
	top = 520;
	context.positionTimerTagDropdown();
	assert.ok(parseFloat(dropdown.style.top) + parseFloat(list.style.maxHeight) <= 630);
	assert.equal(body.scrollTop, 100);
	context.window.innerHeight = 1000;
	top = 600;
	list.scrollHeight = 40;
	context.positionTimerTagDropdown();
	assert.equal(dropdown.style.maxHeight, '40px');
	assert.equal(list.style.maxHeight, '40px');
	assert.equal(content.style.paddingBottom, undefined);
	context.resetTimerTagDropdown();
	assert.equal(classes.has('timer-tags-open'), false);
	assert.equal(content.style.paddingBottom, undefined);
	assert.equal(dropdown.style.top, '');
	assert.equal(list.style.maxHeight, '');
});

test('Bei wenig Platz nach unten sind auch die letzten Stichworte über eine scrollbare Liste erreichbar', () => {
	assert.match(template, /#TimerModal #timer-tag-overlay \.choices__list--dropdown \.choices__list\s*\{[^}]*overflow-y:\s*auto/);
	const start = source.indexOf('function positionTimerTagDropdown(');
	const end = source.indexOf('function resetTimerTagDropdown(', start);
	const list = {scrollHeight: 800, style: {}};
	const dropdown = {style: {}, classList: {add() {}}, querySelector: () => list};
	let top = 840;
	const choices = {getBoundingClientRect: () => ({top, bottom: top + 40, left: 240, width: 570})};
	const modal = {classList: {contains: () => true}};
	const document = {
		getElementById: () => modal,
		querySelector: selector => selector === '#timer-tag-overlay .choices__list--dropdown' ? dropdown : choices
	};
	const context = {document, window: {innerHeight: 1000}};
	vm.runInNewContext(source.slice(start, end), context);
	context.positionTimerTagDropdown();
	assert.equal(dropdown.style.top, '100px');
	assert.equal(dropdown.style.maxHeight, '740px');
	assert.equal(list.style.maxHeight, '740px');
	assert.ok(list.scrollHeight > parseFloat(list.style.maxHeight));
	top = 300;
	context.positionTimerTagDropdown();
	assert.equal(dropdown.style.top, '340px');
	assert.equal(list.style.maxHeight, '560px');
});

test('Beim Öffnen ist das Tag-Dropdown schon vor dem nächsten Animationsframe richtig positioniert', () => {
	const start = source.indexOf('function positionTimerTagDropdown(');
	const end = source.indexOf('function initTimerEditBegin(', start);
	const listeners = {};
	const dropdownListeners = {};
	const classes = new Set();
	const list = {scrollHeight: 180, style: {}};
	const dropdown = {
		style: {}, classList: {add() {}, remove() {}}, querySelector: () => list,
		addEventListener(event, callback, capture) { dropdownListeners[event] = callback; if (event === 'mousedown') assert.equal(capture, true); }
	};
	const choices = {
		getBoundingClientRect: () => ({bottom: 500, left: 200, width: 400})
	};
	const tagElement = {addEventListener: (event, callback) => { listeners[event] = callback; }};
	const modal = {classList: {add: name => classes.add(name), contains: name => classes.has(name), remove: name => classes.delete(name)}, addEventListener() {}};
	const overlay = {appendChild(element) { assert.equal(element, dropdown); }};
	const document = {
		getElementById: id => id === 'TimerModal' ? modal : id === 'timer-tag-overlay' ? overlay : tagElement,
		querySelector: selector => selector === '#editTimerForm .choices' ? choices :
			selector === '#editTimerForm .choices__list--dropdown' || selector === '#timer-tag-overlay .choices__list--dropdown' ? dropdown :
			{addEventListener() {}},
		addEventListener() {}
	};
	const context = {
		document, window: {innerHeight: 1000, addEventListener() {}},
		requestAnimationFrame() { throw new Error('Das Dropdown darf nicht erst im nächsten Frame positioniert werden'); },
		Choices: class { removeActiveItems() {} setChoices() {} setChoiceByValue() {} _onMouseDown(event) { event.selected = true; } },
		owif: {gui: {choicesConfig: {}}}, _tags: [], timerTagChoices: null
	};
	vm.runInNewContext(source.slice(start, end), context);
	context.initTimerTags('');
	listeners.showDropdown();
	assert.equal(dropdown.style.left, '200px');
	assert.equal(dropdown.style.top, '500px');
	assert.equal(dropdown.style.width, '400px');
	assert.equal(list.style.maxHeight, '180px');
	const selection = {};
	dropdownListeners.mousedown(selection);
	assert.equal(selection.selected, true);
	let blocked = false;
	dropdownListeners.click({stopPropagation() { blocked = true; }});
	assert.equal(blocked, true);
});

test('Die Tag-Liste wird erst nach dem Positionieren sichtbar und beim Schließen zurückgesetzt', () => {
	assert.match(template, /#TimerModal #timer-tag-overlay \.choices__list--dropdown\.is-active:not\(\.timer-tags-positioned\)\s*\{[^}]*visibility:\s*hidden/);
	const start = source.indexOf('function positionTimerTagDropdown(');
	const end = source.indexOf('function initTimerTags(', start);
	const classes = new Set();
	const list = {scrollHeight: 120, style: {}};
	const dropdown = {
		style: {}, querySelector: () => list,
		classList: {
			add(name) {
				assert.equal(dropdown.style.left, '250px');
				assert.equal(dropdown.style.top, '500px');
				assert.equal(dropdown.style.width, '320px');
				assert.equal(list.style.maxHeight, '120px');
				classes.add(name);
			},
			remove: name => classes.delete(name)
		}
	};
	const choices = {
		getBoundingClientRect: () => ({bottom: 500, left: 250, width: 320})
	};
	const modal = {classList: {contains: () => true, remove() {}}};
	const document = {
		getElementById: () => modal,
		querySelector: selector => selector === '#editTimerForm .choices' ? choices : dropdown
	};
	const context = {document, window: {innerHeight: 1000}};
	vm.runInNewContext(source.slice(start, end), context);
	context.positionTimerTagDropdown();
	assert.equal(classes.has('timer-tags-positioned'), true);
	context.resetTimerTagDropdown();
	assert.equal(classes.has('timer-tags-positioned'), false);
});

test('Der Overlay benutzt Viewport-Koordinaten unabhängig vom transformierten Dialog', () => {
	const start = source.indexOf('function positionTimerTagDropdown(');
	const end = source.indexOf('function resetTimerTagDropdown(', start);
	const dropdown = {
		style: {}, classList: {add() {}},
		querySelector: () => ({scrollHeight: 200, style: {}})
	};
	const modal = {classList: {contains: () => true}};
	const document = {
		getElementById: () => modal,
		querySelector: selector => selector === '#timer-tag-overlay .choices__list--dropdown' ? dropdown : ({
			getBoundingClientRect: () => ({left: 578.75, bottom: 627.7, width: 420}),
		})
	};
	const context = {document, window: {innerHeight: 1000}};
	vm.runInNewContext(source.slice(start, end), context);
	context.positionTimerTagDropdown();
	assert.equal(dropdown.style.left, '578.75px');
	assert.equal(dropdown.style.top, '627.7px');
	assert.equal(dropdown.style.width, '420px');
});

test('Bekannte und bisher unbekannte Tags erscheinen als Chips; neue Timer beginnen ohne Auswahl', () => {
	const initStart = source.indexOf('function positionTimerTagDropdown(');
	const initEnd = source.indexOf('function initTimerEditBegin(', initStart);
	const start = source.indexOf('function addTimer(');
	const end = source.indexOf('function changeMoviesort(', start);
	const values = new Map([['#bouquet_select option:last', '1:0:1:']]);
	let tagChoices;
	let onKeydown;
	const dropdown = {addEventListener() {}};
	const tagInput = {
		value: '',
		dispatchEvent() {}
	};
	class Choices {
		constructor(element, config) {
			assert.equal(element.id, 'tagsnew');
			assert.equal(config.addChoices, true);
			assert.equal(config.position, 'bottom');
			assert.equal(config.removeItemButton, true);
			tagChoices = this;
			this.choices = [];
			this.selected = [];
		}
		setChoices(choices, value, label, replace) {
			this.choices = replace ? choices.map(choice => choice.value) : this.choices.concat(choices.map(choice => choice.value));
			return this;
		}
		removeActiveItems() { this.selected = []; }
		setChoiceByValue(values) {
			for (const value of Array.isArray(values) ? values : [values]) {
				if (!this.selected.includes(value)) this.selected.push(value);
			}
		}
		getValue(valueOnly) { assert.equal(valueOnly, true); return this.selected; }
	}
	const $ = selector => ({
		length: selector === '#bouquet_select > optgroup' ? 2 : 0,
		val(value) {
			if (arguments.length) { values.set(selector, value); return this; }
			return values.get(selector);
		},
		prop() { return this; },
		trigger() { return this; },
		append() { return this; },
		find() { return this; },
		remove() { return this; },
		end() { return this; },
		text() { return this; },
		removeClass() { return this; },
		addClass() { return this; },
		hide() { return this; },
		show() { return this; },
		removeAttr() { return this; },
		attr() { return this; },
		selectpicker() { return this; },
		datetimepicker() { return this; }
	});
	$.ajax = options => options.success({result: true, timers: [{
		serviceref: '1:0:1:', begin: 100, end: 200, name: 'Film', description: '',
		dirname: 'None', disabled: 0, repeated: 0, tags: 'Film Neu', state: 0
	}]});
	const context = {
		$, Choices, Event: class {}, document: {
			getElementById: id => id === 'TimerModal' ? {addEventListener() {}} :
				id === 'timer-tag-overlay' ? {appendChild(node) { assert.equal(node, dropdown); }} :
				{id: 'tagsnew', addEventListener() {}},
			querySelector: selector => selector === '#TimerModal .modal-body' ? {addEventListener() {}} :
				selector === '#editTimerForm .choices__list--dropdown' ? dropdown : tagInput,
			addEventListener(event, handler, capture) {
				assert.equal(event, 'keydown');
				assert.equal(capture, true);
				onKeydown = handler;
			}
		}, window: {addEventListener() {}},
		owif: {gui: {choicesConfig: {removeItemButton: true}}}, _tags: ['Film', 'Serie'],
		timerTagChoices: null,
		_locations: [], initTimerBQ: (radio, callback) => callback(),
		isRadio: () => false, timeredit_initialized: false, timeredit_begindestroy: false,
		setTimerEditFormTitle: () => {}, tstr_edit_timer: 'Bearbeiten', tstr_add_timer: 'Hinzufügen'
	};
	vm.runInNewContext(source.slice(initStart, initEnd) + source.slice(start, end), context);
	context.editTimer('1:0:1:', 100, 200);
	assert.deepEqual(Array.from(tagChoices.choices), ['Film', 'Serie', 'Neu']);
	assert.deepEqual(Array.from(tagChoices.selected), ['Film', 'Neu']);
	context.addTimer();
	assert.deepEqual(Array.from(tagChoices.selected), []);
	assert.deepEqual(Array.from(tagChoices.choices), ['Film', 'Serie']);
	tagInput.value = ' Eigen Tag ';
	let blocked = false;
	onKeydown({
		target: tagInput,
		key: 'Enter',
		preventDefault() { blocked = true; },
		stopImmediatePropagation() {}
	});
	assert.equal(blocked, true);
	assert.deepEqual(Array.from(tagChoices.selected), ['Eigen_Tag']);
	assert.deepEqual(Array.from(tagChoices.choices), ['Film', 'Serie', 'Eigen_Tag']);
	assert.equal(tagInput.value, '');
	tagInput.value = 'Serie';
	onKeydown({target: tagInput, key: 'Enter', preventDefault() { throw new Error('Bekannten Tag nicht abfangen'); }});
	assert.deepEqual(Array.from(tagChoices.choices), ['Film', 'Serie', 'Eigen_Tag']);
});

for (const editing of [false, true]) {
	test((editing ? 'Timer bearbeiten' : 'Timer hinzufügen') + ' überträgt ausgewählte und neu eingegebene Tags', () => {
		const start = source.indexOf('function btn_saveTimer()');
		const end = source.indexOf('function WebConfig()', start);
		let request;
		const $ = selector => ({
			val: () => 'None',
			is: () => false,
			each: () => {}
		});
		$.ajax = options => {
			request = options;
			options.success({result: true});
		};
		const context = {
			$, moment: () => ({unix: () => 123}),
			timerTagChoices: {getValue: () => ['Film', 'Neu']}, _tags: ['Film', 'Serie'],
			current_serviceref: editing ? '1:0:1:' : '', current_begin: 100, current_end: 200,
			timeredit_begindestroy: false, reloadTimers: false,
			refreshEpgTimers: () => {}
		};
		vm.runInNewContext(source.slice(start, end) + '\nbtn_saveTimer();', context);
		assert.equal(request.url, editing ? 'api/timerchange?' : '/api/timeradd?');
		assert.equal(request.data.tags, 'Film Neu');
		assert.deepEqual(context._tags, ['Film', 'Serie', 'Neu']);
	});
}