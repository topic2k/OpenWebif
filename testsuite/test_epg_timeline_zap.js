const assert = require('node:assert/strict');
const test = require('node:test');
const {source, runScript, readCss} = require('./test_epg_source');

function clickChannel(mode, ref) {
	const start = source.lastIndexOf('if (config.mode', source.indexOf("scope.find('.service').click("));
	const end = source.indexOf("scope.find('.plusclick').click(", start);
	assert.ok(start !== -1 && end !== -1);
	const code = source.slice(start, end);
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
	runScript(code, {jQuery, scope: {find: jQuery}, zapChannel: (...args) => calls.push(args), config: {mode: mode === 'guide' ? 1 : 2}});
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
	assert.ok(/\.modern-epg--timeline \.epg__channel-col\s*\{[^}]*cursor:\s*pointer/.test(readCss()));
});