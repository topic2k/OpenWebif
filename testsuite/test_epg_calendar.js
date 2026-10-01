const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');

test('calendar is placed before weekdays in the shared modern navigation', () => {
	const nav = template.slice(template.indexOf('<div id="navepg">'), template.indexOf('#end for', template.indexOf('<div id="navepg">')));
	assert.ok(nav.includes('id="epg-calendar-toggle"'));
	assert.ok(nav.indexOf('id="epg-calendar-toggle"') < nav.indexOf('#for $slot'));
	assert.ok(nav.includes('id="epg-calendar-popup"'));
});

test('open calendar is not clipped by the scrollable weekday navigation', () => {
	assert.match(template, /#navepg > \.nav-tabs\.epg-calendar-open\s*\{\s*overflow:\s*visible;/);
	assert.match(template, /nav\.toggleClass\('epg-calendar-open', popup\.is\(':visible'\)\)/);
	assert.match(template, /nav\.removeClass\('epg-calendar-open'\)/);
});

test('date offset counts civil days across daylight saving and ignores navigation sentinels', () => {
	const start = template.indexOf('function epgCalendarDayOffset(');
	const end = template.indexOf('\n}', start);
	assert.ok(start !== -1 && end !== -1);
	const context = {};
	vm.runInNewContext(template.slice(start, end + 2), context);
	assert.equal(context.epgCalendarDayOffset(new Date(2026, 9, 2), new Date(2026, 9, 1)), 1);
	assert.equal(context.epgCalendarDayOffset(new Date(2026, 9, 27), new Date(2026, 9, 24)), 3);
	assert.equal(context.epgCalendarDayOffset(new Date(2026, 9, 1), new Date(2026, 9, 3)), -2);
	assert.equal(context.epgCalendarDayOffset(new Date(2027, 3, 22), new Date(2026, 9, 2)), 202);
	assert.match(template, /ajax\/multiepg\?bref=.*&day=' \+ epgCalendarDayOffset/);
	assert.match(template, /api\/epgcalendar\?bref=/);
});

test('loaded EPG dates are bold and clicking a date loads that day for TV and radio', () => {
	const start = template.search(/\(function\(\) \{\r?\n\s*var toggle = jQuery\('#epg-calendar-toggle'\)/);
	const end = template.indexOf('})();', start);
	assert.ok(start !== -1 && end !== -1);
	for (const mode of ['tv', 'radio']) {
		const buttons = [];
		const handlers = {};
		const requests = [];
		const pending = [];
		const window = {};
		const popup = {0: {}, visible: false, toggle() { this.visible = !this.visible; }, is() { return this.visible; }, hide() { this.visible = false; }};
		const nav = {toggleClass(_name, open) { this.open = open; }, removeClass() { this.open = false; }};
		const grid = {
			find() { return {remove: () => { buttons.length = 0; }}; },
			append(item) { if (typeof item !== 'string') buttons.push(item); },
			on(_event, _selector, handler) { handlers.date = handler; }
		};
		const toggle = {
			attr(name, value) { return value === undefined ? 'bouquet & test' : this; },
			closest() { return nav; },
			on(_event, handler) { handlers.toggle = handler; }
		};
		const controls = {on(_event, handler) { handlers.month = handler; }};
		const doc = {off() { return this; }, on() { return this; }};
		const content = {html() { return this; }, load(url) { requests.push(url); }};
		const jQuery = selector => {
			if (selector === '#epg-calendar-toggle') return toggle;
			if (selector === '#epg-calendar-popup') return popup;
			if (selector === '#epg-calendar-grid') return grid;
			if (selector === '#epg-calendar-month') return {text() {}};
			if (selector === '#epg-calendar-prev, #epg-calendar-next') return controls;
			if (selector === '#tvcontent') return content;
			if (selector === doc) return doc;
			if (selector === '<button type="button"></button>') {
				return {
					text(value) { this.number = value; return this; },
					attr() { return this; },
					data(name, value) { if (value === undefined) return this.date; this.date = value; return this; },
					toggleClass(name, present) { this.classes ||= {}; this.classes[name] = present; return this; }
				};
			}
			if (buttons.includes(selector)) return selector;
			throw new Error('Unexpected selector: ' + selector);
		};
		jQuery.contains = () => true;
		jQuery.getJSON = url => {
			requests.push(url);
			const done = [];
			const always = [];
			const request = {
				done(callback) { done.push(callback); return this; },
				always(callback) { always.push(callback); return this; },
				respond(data) { done.forEach(callback => callback(data)); always.forEach(callback => callback()); }
			};
			pending.push(request);
			return request;
		};
		const context = {jQuery, document: doc, window, loadspinner: '', encodeURIComponent, Set, Date, String, JSON};
		vm.runInNewContext(template.slice(template.indexOf('function epgCalendarDayOffset('), end + 5)
			.replaceAll('$day', '0').replaceAll('$week', '0').replaceAll('$epgmode', mode), context);
		assert.equal(requests.length, 1, 'dates are prefetched before the calendar opens');
		handlers.toggle({stopPropagation() {}});
		assert.equal(nav.open, true);
		assert.match(requests[0], /api\/epgcalendar\?bref=bouquet%20%26%20test/);
		assert.equal(requests.length, 1, 'opening while a prefetch is pending does not duplicate it');
		vm.runInNewContext(template.slice(template.indexOf('function epgCalendarDayOffset('), end + 5)
			.replaceAll('$day', '0').replaceAll('$week', '0').replaceAll('$epgmode', mode), context);
		assert.equal(requests.length, 1, 'switching views while loading shares the pending request');
		const chosen = new Date();
		chosen.setDate(7);
		const iso = [chosen.getFullYear(), String(chosen.getMonth() + 1).padStart(2, '0'), '07'].join('-');
		pending[0].respond({result: true, days: [iso]});
		assert.equal(buttons.find(button => button.number === 7).classes['has-epg'], true);
		assert.equal(buttons.find(button => button.number === 8).classes['has-epg'], false);
		vm.runInNewContext(template.slice(template.indexOf('function epgCalendarDayOffset('), end + 5)
			.replaceAll('$day', '0').replaceAll('$week', '0').replaceAll('$epgmode', mode), context);
		assert.equal(requests.length, 1, 'switching views reuses the fetched days');
		handlers.toggle({stopPropagation() {}});
		handlers.toggle({stopPropagation() {}});
		assert.equal(buttons.find(button => button.number === 7).classes['has-epg'], true);
		handlers.month.call({id: 'epg-calendar-next'});
		assert.equal(requests.length, 2, 'moving to another month fetches its days');
		handlers.month.call({id: 'epg-calendar-prev'});
		assert.equal(requests.length, 2, 'returning to a cached month does not refetch');
		pending[1].respond({result: true, days: []});
		assert.equal(buttons.find(button => button.number === 7).classes['has-epg'], true, 'a late response for another month is ignored');
		handlers.month.call({id: 'epg-calendar-next'});
		assert.equal(requests.length, 2, 'an empty month is also cached');
		handlers.month.call({id: 'epg-calendar-next'});
		assert.equal(requests.length, 3);
		pending[2].respond({result: false});
		handlers.month.call({id: 'epg-calendar-prev'});
		handlers.month.call({id: 'epg-calendar-next'});
		assert.equal(requests.length, 4, 'failed queries can be retried');
		handlers.month.call({id: 'epg-calendar-prev'});
		handlers.month.call({id: 'epg-calendar-prev'});
		handlers.date.call(buttons.find(button => button.number === 7));
		assert.match(requests.at(-1), new RegExp('ajax/multiepg\\?bref=bouquet%20%26%20test&day=-?\\d+&epgmode=' + mode + '&week=0'));
	}
});