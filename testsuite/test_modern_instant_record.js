const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const root = join(__dirname, '..');
const template = readFileSync(join(root, 'plugin/controllers/views/responsive/main.tmpl'), 'utf8');
const script = readFileSync(join(root, 'sourcefiles/modern/js/responsive.js'), 'utf8');
const handler = script.slice(script.indexOf('function startInstantRecord()'), script.indexOf('\nfunction deleteTimer('));

test('modern header uses a handler that reports the recording result', () => {
	assert.ok(/id="osd__current-event__record"[^>]*onclick="startInstantRecord\(\);"/.test(template));
	assert.ok(handler.startsWith('function startInstantRecord()'));
	assert.ok(readFileSync(join(root, 'plugin/public/modern/js/responsive.min.js'), 'utf8').includes('function startInstantRecord()'));
});

test('instant recording still requests the receiver API', async () => {
	const source = readFileSync(join(root, 'sourcefiles/modern/js/owif.js'), 'utf8');
	const stb = source.slice(source.indexOf('class STB {'), source.indexOf('\nclass API {'));
	const requests = [];
	const context = { fetch: async url => {
		requests.push(url);
		return { ok: true, json: async () => ({ result: true, message: 'Recording started' }) };
	} };
	runInNewContext(stb + '\nthis.STB = STB;', context);
	assert.equal((await new context.STB().instantRecord()).result, true);
	assert.deepEqual(requests, ['/api/recordnow?infinite=true']);
});

function setup(instantRecord) {
	const button = { disabled: false };
	const messages = [];
	let refreshes = 0;
	const context = {
		document: { getElementById: () => button },
		owif: { stb: { instantRecord } },
		showErrorMain: (text, result) => messages.push([text, result]),
		getStatusInfo: () => { refreshes++; },
		tstr_oops: 'Oops',
	};
	runInNewContext(handler, context);
	return { button, messages, refreshes: () => refreshes, start: () => context.startInstantRecord() };
}

test('successful instant recording is reported and refreshes the header', async () => {
	let finish;
	const recording = new Promise(resolve => { finish = resolve; });
	let requests = 0;
	const ui = setup(() => { requests++; return recording; });
	const pending = ui.start();
	assert.equal(ui.button.disabled, true);
	await ui.start();
	assert.equal(requests, 1, 'repeated clicks must not start another recording');
	finish({ result: true, message: 'Recording started' });
	await pending;
	assert.deepEqual(ui.messages, [['Recording started', true]]);
	assert.equal(ui.refreshes(), 1);
	assert.equal(ui.button.disabled, false);
});

test('API rejection is reported without claiming recording started', async () => {
	const ui = setup(async () => ({ result: false, message: 'Timer conflict detected! Not recording!' }));
	await ui.start();
	assert.deepEqual(ui.messages, [['Timer conflict detected! Not recording!', false]]);
	assert.equal(ui.refreshes(), 0);
	assert.equal(ui.button.disabled, false);
});

test('network failure is reported and allows another attempt', async () => {
	const ui = setup(async () => { throw new Error('Network unavailable'); });
	await ui.start();
	assert.deepEqual(ui.messages, [['Network unavailable', false]]);
	assert.equal(ui.refreshes(), 0);
	assert.equal(ui.button.disabled, false);
});