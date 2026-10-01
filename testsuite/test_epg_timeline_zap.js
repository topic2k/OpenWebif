const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'controllers', 'views', 'responsive', 'ajax', 'multiepg.tmpl'), 'utf8');

function clickChannel(mode, ref) {
	const start = template.lastIndexOf('#if $mode == 1', template.indexOf('jQuery(".service").click('));
	const end = template.indexOf('jQuery(".plusclick").click(', start);
	assert.ok(start !== -1 && end !== -1);
	const branches = template.slice(start, end).split('#else');
	const branch = mode === 'guide' ? branches[0] : branches[1];
	assert.ok(branch, 'Zeitstrahl benötigt einen eigenen Senderklick-Handler');
	const code = branch.replace(/^#(?:if \$mode == 1|end if)\r?$/gm, '');
	const calls = [];
	let selector;
	let handler;
	const channel = {ref};
	const jQuery = target => {
		if (typeof target === 'string') return {
			click(fn) { selector = target; handler = fn; }
		};
		assert.equal(target, channel);
		return {
			data: name => name === 'ref' && mode === 'guide' ? ref : undefined,
			closest: name => {
				assert.equal(name, '.epg__timeline-row');
				return {data: key => key === 'ref' ? ref : undefined};
			}
		};
	};
	vm.runInNewContext(code, {jQuery, zapChannel: (...args) => calls.push(args)});
	assert.equal(selector, mode === 'guide' ? '.service' : '.epg__channel-col');
	handler.call(channel);
	return calls;
}

test('Senderklick schaltet in Zeitschrift und Zeitstrahl über dieselbe Referenz um', () => {
	for (const mode of ['guide', 'timeline']) {
		assert.deepEqual(clickChannel(mode, '1%3a0%3a1%3a42'), [['1%3a0%3a1%3a42', '']]);
	}
});

test('Sender ohne Referenz lösen in keiner Ansicht ein Umschalten aus', () => {
	for (const mode of ['guide', 'timeline']) {
		assert.deepEqual(clickChannel(mode, undefined), []);
	}
});

test('Im Zeitstrahl ist die gesamte Senderspalte als klickbar erkennbar', () => {
	assert.ok(/\.epg__channel-col\s*\{[^}]*cursor:\s*pointer/.test(template));
});