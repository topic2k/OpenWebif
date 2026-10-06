const assert = require('node:assert/strict');
const { test } = require('node:test');
const {functionSource, runScript} = require('./test_epg_source');

const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const stamp = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime() / 1000;

function element(rect, attributes = {}, children = {}) {
	return {
		getBoundingClientRect: () => rect,
		getAttribute: name => attributes[name],
		querySelectorAll: selector => children[selector] || []
	};
}

function displayDate({ magazine, scrollTop = 0, scrollLeft = 0, width = 600, rows, disposed = false, replaced = false,
	timelineEnd = stamp(3, 0) }) {
	const source = functionSource('alive') + '\n' + functionSource('updateEpgDateRange');
	const label = {textContent: ''};
	const container = element({top: 100, bottom: 500, left: 0, right: width}, {
		'data-slot-start': stamp(1, 0), 'data-first': stamp(1, 0), 'data-timeline-end': timelineEnd
	}, {
		'#tbl1body tr': rows,
		'.epg__event[data-begin]': rows.flatMap(row => row.querySelectorAll('.epg__event[data-begin]')),
		'.epg__timeline-row': rows
	});
	container.scrollTop = scrollTop;
	container.scrollLeft = scrollLeft;
	container.clientWidth = width;
	container.classList = {contains: name => magazine && name === 'epg__tv-guide'};
	runScript(source + '\nupdateEpgDateRange();', {
		document: {getElementById: id => id === 'fulltbl' ? (replaced ? {} : container) : label},
		tableNode: container, disposed,
		config: {slotStart: stamp(1, 0), dateLabels: {weekdays, months}}, Date
	});
	return label.textContent;
}

test('Zeitschrift zeigt morgens Vortag und gewählten Tag, nach Scrollen nur den gewählten Tag', () => {
	const previous = element({top: 115, bottom: 160, left: 5, right: 300}, {'data-begin': stamp(0, 22, 50)});
	const today = element({top: 175, bottom: 235, left: 5, right: 300}, {'data-begin': stamp(1, 0, 5)});
	const tomorrow = element({top: 1215, bottom: 1270, left: 5, right: 300}, {'data-begin': stamp(2, 0, 5)});
	const first = element({top: 100, bottom: 500, left: 0, right: 600}, {}, {'.epg__event[data-begin]': [previous, today]});
	const afternoon = element({top: 715, bottom: 770, left: 5, right: 300}, {'data-begin': stamp(1, 15)});
	const middle = element({top: 700, bottom: 1100, left: 0, right: 600}, {}, {'.epg__event[data-begin]': [afternoon]});
	const last = element({top: 1200, bottom: 1600, left: 0, right: 600}, {}, {'.epg__event[data-begin]': [tomorrow]});
	const rows = [first, ...Array.from({length: 6}, () => element({top: 500, bottom: 500, left: 0, right: 600})), middle, last];
	assert.equal(displayDate({magazine: true, rows}), 'Mi, 30.Sep 2026 / Do, 1.Okt 2026');
	const scrolled = rows.map(row => ({
		...row,
		querySelectorAll: selector => row.querySelectorAll(selector).map(event => ({
			...event, getBoundingClientRect: () => {
				const rect = event.getBoundingClientRect();
				return {...rect, top: rect.top - 600, bottom: rect.bottom - 600};
			}
		})),
		getBoundingClientRect: () => {
			const rect = row.getBoundingClientRect();
			return {...rect, top: rect.top - 600, bottom: rect.bottom - 600};
		}
	}));
	assert.equal(displayDate({magazine: true, rows: scrolled, scrollTop: 600}), 'Do, 1.Okt 2026');
});

test('Zeitschrift berücksichtigt slotübergreifende Sendungen aus einer unsichtbaren Ursprungszeile', () => {
	const event = element({top: 50, bottom: 300, left: 0, right: 200}, {'data-begin': stamp(0, 23)});
	const row = element({top: -400, bottom: 80, left: 0, right: 600}, {}, {'.epg__event[data-begin]': [event]});
	assert.equal(displayDate({magazine: true, rows: [row]}), 'Mi, 30.Sep 2026');
});

test('Zeitstrahl berücksichtigt nur das sichtbare Zeitfenster und über Mitternacht laufende Sendungen', () => {
	const earlier = element({top: 120, bottom: 180, left: 142, right: 192}, {
		'data-begin': stamp(0, 23, 30), 'data-end': stamp(1, 0, 30)
	});
	const row = element({top: 100, bottom: 160, left: 0, right: 30140}, {}, {'.eventlist .event[data-begin]': [earlier]});
	assert.equal(displayDate({magazine: false, rows: [row]}), 'Mi, 30.Sep 2026 / Do, 1.Okt 2026');
	assert.equal(displayDate({magazine: false, rows: [row], scrollLeft: 14 * 600}), 'Do, 1.Okt 2026');
	assert.equal(displayDate({magazine: false, rows: [row], scrollLeft: 23 * 600 + 45 * 10}), 'Do, 1.Okt 2026 / Fr, 2.Okt 2026');
});

test('beide Ansichten ändern das Datum nach Entsorgung oder Ersetzen der Tabelle nicht mehr', () => {
	for (const magazine of [true, false]) {
		assert.equal(displayDate({magazine, rows: [], disposed: true}), '');
		assert.equal(displayDate({magazine, rows: [], replaced: true}), '');
	}
});

test('Zeitstrahl zeigt hinter dem letzten Sendungsende keine erfundenen Folgetage', () => {
	assert.equal(displayDate({magazine: false, rows: [], width: 2000,
		scrollLeft: 23 * 600 + 45 * 10, timelineEnd: stamp(2, 0)}), 'Do, 1.Okt 2026');
	assert.equal(displayDate({magazine: false, rows: [], timelineEnd: stamp(1, 0)}), 'Do, 1.Okt 2026');
	assert.equal(displayDate({magazine: false, rows: [], scrollLeft: 100000,
		timelineEnd: stamp(1, 0)}), 'Do, 1.Okt 2026');
});