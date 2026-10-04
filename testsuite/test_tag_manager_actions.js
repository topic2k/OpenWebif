const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../plugin/public/modern/js/tagmanager.min.js'), 'utf8');

function setup() {
	const state = {name: ' Neu ', tag: 'Alt', answer: ' Umbenannt ', requests: [], reloads: [], handlers: [], modalCalls: []};
	class Element {
		constructor(tag) { this.tag = tag; this.attributes = {}; this.classes = ''; this.children = []; this.value = ''; this.content = ''; this.handlers = {}; }
		attr(name, value) { if (value === undefined) return this.attributes[name]; this.attributes[name] = value; return this; }
		addClass(value) { this.classes += ' ' + value; return this; }
		css() { return this; }
		text(value) { if (value === undefined) return this.content || this.children.map(child => child.text()).join(''); this.content = value; this.children = []; return this; }
		empty() { this.content = ''; this.children = []; return this; }
		append(child) { child.parent = this; this.children.push(child); return this; }
		find(selector) {
			const matches = child => selector.startsWith('.') ? child.classes.split(' ').includes(selector.slice(1)) : child.tag === selector;
			const visit = child => child.children.flatMap(next => [next, ...visit(next)]);
			const found = visit(this).find(matches);
			assert.ok(found, selector);
			return found;
		}
		closest(tag) { return this.tag === tag ? this : this.parent.closest(tag); }
		remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
		val(value) { if (value === undefined) return this.value; this.value = value; return this; }
		focus() { state.focused = true; return this; }
		off() { this.handlers = {}; return this; }
		on(event, callback) { this.handlers[event.split('.')[0]] = callback; return this; }
		modal(action) { state.modalCalls.push(action); const event = action === 'show' ? 'shown' : 'hidden'; if (this.handlers[event]) this.handlers[event](); return this; }
	}
	const alert = prefix => ({
		text(value) { state[prefix + 'Error'] = value; return this; },
		show() { state[prefix + 'ErrorVisible'] = true; return this; },
		hide() { state[prefix + 'ErrorVisible'] = false; return this; }
	});
	const error = alert('main');
	const renameError = alert('rename');
	const deleteError = alert('delete');
	const controls = {prop(name, value) { assert.equal(name, 'disabled'); state.disabled = value; }};
	const name = new Element('input');
	name.val(state.name);
	const renameName = new Element('input');
	const renameDialog = new Element('div');
	const deleteName = new Element('span');
	const deleteDialog = new Element('div');
	const tbody = new Element('tbody');
	const row = new Element('tr').attr('data-tag', state.tag);
	row.append(new Element('td').addClass('tagmanager-label').text('Alt'));
	row.append(new Element('td').addClass('tagmanager-usage').text('Timer: 1'));
	const actions = new Element('td');
	const button = new Element('button');
	actions.append(button);
	row.append(actions);
	tbody.append(row);
	Object.defineProperty(state, 'tag', {
		get: () => row.attr('data-tag'),
		set: value => { row.attr('data-tag', value); row.find('.tagmanager-label').text(value.replace(/_/g, ' ')); }
	});
	Object.defineProperty(state, 'name', {get: () => name.val(), set: value => name.val(value)});
	Object.defineProperty(state, 'answer', {get: () => renameName.val(), set: value => renameName.val(value)});
	state.answer = ' Umbenannt ';
	state.rows = tbody.children;
	state.row = row;
	state.deleteName = deleteName;
	const manager = {
		0: {}, length: 1,
		attr: name => ({'data-error': 'Fehler', 'data-invalid': 'Ungültiges Stichwort',
			'data-usage-unknown': 'Unbekannt', 'data-not-used': 'Nicht verwendet', 'data-label-timers': 'Timer',
			'data-label-recordings': 'Aufnahmen', 'data-label-autotimers': 'AutoTimer',
			'data-edit-title': 'Bearbeiten', 'data-delete-title': 'Löschen'})[name],
		find(selector) {
			const elements = {
				'#tagmanager-error': error,
				'#tagmanager-rename': renameDialog,
				'#tagmanager-rename-error': renameError,
				'#tagmanager-rename-name': renameName,
				'#tagmanager-delete-dialog': deleteDialog,
				'#tagmanager-delete-error': deleteError,
				'#tagmanager-delete-name': deleteName,
				'#tagmanager-name': name,
				'label[for="tagmanager-name"]': {text: () => 'Stichwort'},
				'button, input': controls,
				'tbody': tbody
			};
			assert.ok(elements[selector], selector);
			return elements[selector];
		},
		off(namespace) { assert.equal(namespace, '.tagmanager'); state.handlers = []; return this; },
		on(event, selector, callback) { state.handlers.push({event, selector, callback}); return this; }
	};
	const $ = selector => {
		if (selector === '#tagmanager') return manager;
		if (selector instanceof Element) return selector;
		if (selector.startsWith('<')) return new Element(selector.slice(1, -1));
		throw new Error(selector);
	};
	$.ajax = options => {
		const request = {
			options,
			done(callback) { this.resolve = callback; return this; },
			fail(callback) { this.reject = callback; return this; },
			always(callback) { this.finish = callback; return this; }
		};
		state.requests.push(request);
		return request;
	};
	const context = {
		$, document: {getElementById: () => state.navigated ? null : manager[0]},
		window: {
			prompt: () => { throw new Error('Browser-Dialog darf nicht verwendet werden'); },
			confirm: () => { throw new Error('Browser-Dialog darf nicht verwendet werden'); }
		},
		load_maincontent_spin_force: url => state.reloads.push(url)
	};
	vm.runInNewContext(script, context);
	state.init = () => context.initTagManager();
	state.trigger = selector => {
		for (const handler of state.handlers.filter(handler => handler.selector === selector)) {
			handler.callback.call(state.button || button, {preventDefault() { state.prevented = true; }});
		}
	};
	state.rename = (value, updateUses = false) => {
		state.trigger('.tagmanager-edit');
		if (value !== undefined) state.answer = value;
		state.trigger(updateUses ? '#tagmanager-rename-update' : '#tagmanager-rename-form');
	};
	state.cancel = () => renameDialog.modal('hide');
	state.delete = (updateUses = false) => {
		state.trigger('.tagmanager-delete');
		state.trigger(updateUses ? '#tagmanager-delete-update' : '#tagmanager-delete-confirm');
	};
	state.cancelDelete = () => deleteDialog.modal('hide');
	state.init();
	return state;
}

for (const [selector, data] of [
	['#tagmanager-add', {action: 'add', tag: 'Neu'}],
	['.tagmanager-edit', {action: 'rename', tag: 'Alt', newtag: 'Umbenannt'}],
	['.tagmanager-delete', {action: 'delete', tag: 'Alt'}]
]) {
	test('Die ausgelieferte Oberfläche sendet ' + data.action + ' und aktualisiert nach Erfolg die Liste', () => {
		const state = setup();
		if (selector === '.tagmanager-edit') state.rename(' Umbenannt ');
		else if (selector === '.tagmanager-delete') state.delete();
		else state.trigger(selector);
		assert.equal(state.requests.length, 1);
		const request = state.requests[0];
		assert.deepEqual(JSON.parse(JSON.stringify(request.options)), {url: '/api/tagmanager', type: 'POST', dataType: 'json', data});
		if (data.action === 'add') assert.equal(state.prevented, true);
		assert.equal(state.disabled, true);
		request.resolve({result: true, usage: {timers: 2, movies: 0, autotimers: 1}});
		request.finish();
		assert.deepEqual(state.reloads, []);
		assert.equal(state.disabled, false);
		if (data.action === 'add') {
			assert.equal(state.rows.length, 2);
			assert.equal(state.rows[1].attr('data-tag'), 'Neu');
			assert.equal(state.rows[1].find('.tagmanager-label').text(), 'Neu');
			assert.equal(state.rows[1].find('.tagmanager-usage').text(), 'Timer: 2AutoTimer: 1');
			assert.equal(state.rows[1].find('.tagmanager-edit').attr('title'), 'Bearbeiten');
			assert.equal(state.name, '');
		} else if (data.action === 'rename') {
			assert.equal(state.rows.length, 1);
			assert.equal(state.row.attr('data-tag'), 'Umbenannt');
			assert.equal(state.row.find('.tagmanager-usage').text(), 'Timer: 2AutoTimer: 1');
		} else {
			assert.equal(state.rows.length, 0);
			assert.deepEqual(state.modalCalls, ['show', 'hide']);
		}
	});
}

test('Entfernen + Verwendungen anpassen verlangt eine ausdrückliche Aktion', () => {
	const state = setup();
	state.trigger('.tagmanager-delete');
	assert.equal(state.requests.length, 0);
	assert.equal(state.rows.length, 1);
	assert.equal(state.deleteName.text(), 'Alt');
	state.trigger('#tagmanager-delete-update');
	assert.deepEqual(JSON.parse(JSON.stringify(state.requests[0].options.data)), {
		action: 'delete', tag: 'Alt', updateuses: '1'
	});
	state.requests[0].resolve({result: true, updated: {timers: 1, movies: 0, autotimers: 1}});
	state.requests[0].finish();
	assert.equal(state.rows.length, 0);
	assert.deepEqual(state.modalCalls, ['show', 'hide']);
	assert.deepEqual(state.reloads, []);
});

test('Fehler beim Entfernen von Verwendungen bleiben im Löschdialog für einen erneuten Versuch', () => {
	const state = setup();
	state.delete(true);
	state.trigger('#tagmanager-delete-confirm');
	assert.equal(state.requests.length, 1);
	state.requests[0].resolve({result: false, message: 'Schreiben fehlgeschlagen; teilweise geändert'});
	state.requests[0].finish();
	assert.deepEqual(state.modalCalls, ['show']);
	assert.equal(state.deleteError, 'Schreiben fehlgeschlagen; teilweise geändert');
	assert.equal(state.deleteErrorVisible, true);
	assert.equal(state.rows.length, 1);
	assert.equal(state.disabled, false);
	state.trigger('#tagmanager-delete-update');
	assert.equal(state.requests.length, 2);
});

test('Übernehmen + Verwendungen anpassen aktualisiert Zuordnungen nur auf ausdrücklichen Wunsch', () => {
	const state = setup();
	state.rename('Mit Leerzeichen', true);
	assert.deepEqual(JSON.parse(JSON.stringify(state.requests[0].options.data)), {
		action: 'rename', tag: 'Alt', newtag: 'Mit_Leerzeichen', updateuses: '1'
	});
	assert.deepEqual(state.modalCalls, ['show']);
	state.requests[0].resolve({result: true, usage: {timers: 2, movies: 1, autotimers: 1}});
	state.requests[0].finish();
	assert.deepEqual(state.modalCalls, ['show', 'hide']);
	assert.equal(state.rows[0].find('.tagmanager-usage').text(), 'Timer: 2Aufnahmen: 1AutoTimer: 1');
	assert.equal(state.tag, 'Mit_Leerzeichen');
	assert.deepEqual(state.reloads, []);
});

test('Der Umbenennen-Dialog bleibt bei Validierungs- und Serverfehlern geöffnet', () => {
	const state = setup();
	state.rename('mit\nUmbruch', true);
	assert.equal(state.renameError, 'Ungültiges Stichwort');
	assert.deepEqual(state.modalCalls, ['show']);
	state.trigger('#tagmanager-rename-update');
	assert.equal(state.requests.length, 0);
	state.answer = 'Neu';
	state.trigger('#tagmanager-rename-update');
	state.trigger('#tagmanager-rename-form');
	assert.equal(state.requests.length, 1);
	state.requests[0].resolve({result: false, message: 'Kann nicht speichern'});
	state.requests[0].finish();
	assert.deepEqual(state.modalCalls, ['show']);
	assert.equal(state.renameError, 'Kann nicht speichern');
	assert.equal(state.renameErrorVisible, true);
	assert.equal(state.tag, 'Alt');
	state.trigger('#tagmanager-rename-form');
	assert.equal(state.requests.length, 2);
});

test('Neue Stichworte zeigen tatsächliche Verwendung, auch wenn sie vorher nicht bekannt waren', () => {
	const state = setup();
	state.name = 'Schon bekannt';
	state.trigger('#tagmanager-add');
	state.requests[0].resolve({result: true, usage: {timers: 0, movies: 3, autotimers: 0}});
	state.requests[0].finish();
	assert.equal(state.rows[1].find('.tagmanager-usage').text(), 'Aufnahmen: 3');
	state.button = state.rows[1].find('.tagmanager-delete');
	state.delete();
	assert.equal(state.requests[1].options.data.tag, 'Schon_bekannt');
});

test('Fehlgeschlagene Verwendungsabfrage wird ohne Seitenneuladen als unbekannt dargestellt', () => {
	const state = setup();
	state.trigger('#tagmanager-add');
	state.requests[0].resolve({result: true, usage: null});
	state.requests[0].finish();
	assert.equal(state.rows[1].find('.tagmanager-usage').text(), 'Unbekannt');
	assert.deepEqual(state.reloads, []);
});

test('Die neu erstellte Zeile übernimmt auch unbelegte Verwendungen und escaped Sonderzeichen', () => {
	const state = setup();
	state.name = 'A_"B"_<C>&';
	state.trigger('#tagmanager-add');
	state.requests[0].resolve({result: true, usage: {timers: 0, movies: 0, autotimers: 0}});
	state.requests[0].finish();
	assert.equal(state.rows[1].attr('data-tag'), 'A_"B"_<C>&');
	assert.equal(state.rows[1].find('.tagmanager-label').text(), 'A "B" <C>&');
	assert.equal(state.rows[1].find('.tagmanager-usage').text(), 'Nicht verwendet');
});

test('Ungültige Namen werden beim Anlegen und Umbenennen nicht gesendet', () => {
	for (const invalid of ['', '   ', 'mit\nUmbruch', 'mit\tTab', 'mit\rUmbruch', 'mit\u0000Null', 'mit\u007fDEL', 'x'.repeat(101)]) {
		for (const selector of ['#tagmanager-add', '.tagmanager-edit']) {
			const state = setup();
			state.name = invalid;
			if (selector === '.tagmanager-edit') state.rename(invalid);
			else state.trigger(selector);
			assert.equal(state.requests.length, 0);
			assert.equal(selector === '.tagmanager-edit' ? state.renameError : state.mainError, 'Ungültiges Stichwort');
			assert.equal(selector === '.tagmanager-edit' ? state.renameErrorVisible : state.mainErrorVisible, true);
		}
	}
});

test('Leerzeichen werden wie in openATV normalisiert; Kommas und Großschreibung bleiben erhalten', () => {
	for (const [entered, stored] of [
		['  meine  Filme  ', 'meine__Filme'], [' Krimi, Drama ', 'Krimi,_Drama'],
		['Ärger & Spaß', 'Ärger_&_Spaß'], ['_Rand_', '_Rand_']
	]) {
		for (const selector of ['#tagmanager-add', '.tagmanager-edit']) {
			const state = setup();
			state.name = entered;
			if (selector === '.tagmanager-edit') state.rename(entered);
			else state.trigger(selector);
			assert.equal(state.requests.length, 1);
			const data = state.requests[0].options.data;
			assert.equal(selector === '#tagmanager-add' ? data.tag : data.newtag, stored);
		}
	}
});

test('Bearbeiten und Löschen verwenden den Speicherwert statt der lesbaren Beschriftung', () => {
	for (const tag of ['Meine__Filme', '_Rand_', 'Krimi,_Drama', 'A_"B"_<C>&']) {
		for (const selector of ['.tagmanager-edit', '.tagmanager-delete']) {
			const state = setup();
			state.tag = tag;
			if (selector === '.tagmanager-edit') state.rename(' Umbenannt ');
			else state.delete();
			assert.equal(state.requests.length, 1);
			assert.equal(state.requests[0].options.data.tag, tag);
			if (selector === '.tagmanager-edit') assert.equal(state.modalCalls[0], 'show');
			else assert.equal(state.deleteName.text(), tag.replace(/_/g, ' '));
		}
	}
});

test('Ein nur anders dargestellter Name löst kein Umbenennen aus', () => {
	for (const [tag, answer] of [
		['Meine_Filme', 'Meine Filme'], ['Meine_Filme', ' Meine Filme '],
		['Meine_Filme', 'Meine_Filme'], ['_Rand_', ' Rand '], ['__', '  ']
	]) {
		const state = setup();
		state.tag = tag;
		state.rename(answer);
		assert.equal(state.requests.length, 0);
	}
});

test('Abbrechen und unveränderte Namen ändern nichts', () => {
	const state = setup();
	state.trigger('.tagmanager-edit');
	assert.equal(state.answer, 'Alt');
	assert.equal(state.focused, true);
	state.cancel();
	for (const answer of ['Alt', ' Alt ']) {
		state.rename(answer);
		state.cancel();
	}
	state.trigger('.tagmanager-delete');
	state.cancelDelete();
	assert.deepEqual(state.modalCalls.slice(-2), ['show', 'hide']);
	assert.equal(state.requests.length, 0);
});

test('Erneute Initialisierung und Mehrfachklicks lösen keine doppelten Anfragen aus', () => {
	const state = setup();
	state.init();
	state.trigger('#tagmanager-add');
	state.trigger('#tagmanager-add');
	state.trigger('.tagmanager-edit');
	state.trigger('.tagmanager-delete');
	assert.equal(state.requests.length, 1);
});

test('API- und Netzwerkfehler werden angezeigt und erlauben einen erneuten Versuch', () => {
	for (const [method, response, message] of [
		['resolve', {result: false, message: '<b>Tag already exists</b>'}, '<b>Tag already exists</b>'],
		['resolve', null, 'Fehler'],
		['reject', {responseJSON: {message: 'Read only'}}, 'Read only'],
		['reject', {}, 'Fehler']
	]) {
		const state = setup();
		state.trigger('#tagmanager-add');
		state.requests[0][method](response);
		state.requests[0].finish();
		assert.equal(state.mainError, message);
		assert.equal(state.mainErrorVisible, true);
		assert.equal(state.disabled, false);
		assert.equal(state.reloads.length, 0);
		state.trigger('#tagmanager-add');
		assert.equal(state.requests.length, 2);
		assert.equal(state.mainErrorVisible, false);
	}
});

test('Eine verspätete Antwort holt die Verwaltung nach Seitenwechsel nicht zurück', () => {
	const state = setup();
	state.trigger('#tagmanager-add');
	state.navigated = true;
	state.requests[0].resolve({result: true});
	state.requests[0].finish();
	assert.equal(state.reloads.length, 0);
	assert.equal(state.rows.length, 1);
});