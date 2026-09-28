const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const template = readFileSync(path.join(__dirname, '../plugin/controllers/views/responsive/ajax/multiepg.tmpl'), 'utf8').replace(/\r\n/g, '\n');

function renderMarker(now, slotStart, rowHeights) {
	const start = template.indexOf('function updateTvGuideNowMarker() {');
	assert.notEqual(start, -1, 'TV guide now-marker function is missing');
	const end = template.indexOf('\n\t}', start);
	assert.notEqual(end, -1);
	const functionBody = template.slice(start, end + 3).replace('$slot_start', 'slotStart');
	const marker = { length: 1, styles: {}, visible: false,
		css(styles) { Object.assign(this.styles, styles); return this; },
		show() { this.visible = true; return this; },
		hide() { this.visible = false; return this; }
	};
	let scrollTop = 45;
	const rows = rowHeights.map((height, index) => ({
		length: 1,
		offset() { return { top: 150 - scrollTop + rowHeights.slice(0, index).reduce((a, b) => a + b, 0) }; },
		outerHeight() { return height; }
	}));
	const selections = {
		'.epg__tv-guide-now': marker,
		'#tbl1body tr': { length: rows.length, eq(index) { return rows[index]; } },
		'#fulltbl': { offset() { return { top: 100 }; }, scrollTop() { return scrollTop; } },
		'#tbl1': { outerWidth() { return 900; } }
	};
	const context = { jQuery: selector => selections[selector], Date: { now: () => now * 1000 }, slotStart, marker };
	vm.runInNewContext(functionBody + '\nupdateTvGuideNowMarker();', context);
	return marker;
}

test('today shows a horizontal line across the table, interpolated within the two-hour row', () => {
	const marker = renderMarker(3600, 0, [100, 200]);
	assert.equal(marker.visible, true);
	assert.equal(marker.styles.top, '100px');
	assert.equal(marker.styles.width, '900px');
});

test('the line moves into the next row and uses its actual height', () => {
	const marker = renderMarker(7200 + 1800, 0, [100, 200]);
	assert.equal(marker.visible, true);
	assert.equal(marker.styles.top, '200px');
});

test('times outside the displayed 24-hour range do not show a line', () => {
	assert.equal(renderMarker(-1, 0, [100, 200]).visible, false);
	assert.equal(renderMarker(14400, 0, [100, 200]).visible, false);
});

test('the marker is only rendered for today in the current week', () => {
	assert.ok(/#if \$mode == 1[\s\S]*?<div id="fulltbl"[\s\S]*?#if \$day == 0 and \$week == 0\s*<div class="epg__tv-guide-now"/.test(template), 'the marker must be rendered only for the current day and week');
});