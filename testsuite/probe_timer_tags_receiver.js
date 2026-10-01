// Optional live probe: disabled unless explicitly authorized for a specific test device.
const assert = require('node:assert/strict');

const host = process.env['OPENWEBIF_TEST_RECEIVER_HOST'];
const user = process.env['OPENWEBIF_TEST_RECEIVER_USER'];
const password = process.env['OPENWEBIF_TEST_RECEIVER_PASSWORD'];

async function main() {
	const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
	const page = targets.find(target => target.type === 'page');
	assert.ok(page, 'Chrome debugging page not found');
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
	let id = 0;
	const pending = new Map();
	socket.onmessage = ({data}) => {
		const message = JSON.parse(data);
		if (!pending.has(message.id)) return;
		const {resolve, reject} = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) reject(Error(JSON.stringify(message.error)));
		else resolve(message.result);
	};
	const send = (method, params = {}) => new Promise((resolve, reject) => {
		pending.set(++id, {resolve, reject});
		socket.send(JSON.stringify({id, method, params}));
	});
	const evaluate = async expression => {
		const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
		if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
		return result.result.value;
	};
	try {
		await send('Network.enable');
		await send('Network.setCacheDisabled', {cacheDisabled: true});
		await send('Network.setExtraHTTPHeaders', {headers: {Authorization: 'Basic ' + Buffer.from(user + ':' + password).toString('base64')}});
		await send('Page.enable');
		const width = Number(process.env['OPENWEBIF_TEST_VIEWPORT_WIDTH'] || 1440);
		const height = Number(process.env['OPENWEBIF_TEST_VIEWPORT_HEIGHT'] || 1000);
		await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
		const probeId = Date.now();
		await send('Page.navigate', {url: `http://${host}/?tag-probe=${probeId}#timers`});
		for (let attempt = 0; attempt < 60; attempt++) {
			try {
				if (await evaluate(`location.search.includes('tag-probe=${probeId}') && !!(window.jQuery && document.querySelector('#TimerModal') && document.querySelector('#editTimerForm #tagsnew'))`)) break;
			} catch (error) { /* Navigation replaces the JavaScript execution context. */ }
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		assert.ok(await evaluate(`location.search.includes('tag-probe=${probeId}') && !!document.querySelector('#editTimerForm #tagsnew')`), 'Timer editor not loaded');
		const result = await evaluate(`(async () => {
			$('#TimerModal').modal('show');
			for (let n = 0; n < 100 && (!document.querySelector('#TimerModal.in #editTimerForm .choices__input--cloned') || !document.querySelector('#TimerModal.in #editTimerForm .choices').getBoundingClientRect().width); n++) await new Promise(r => setTimeout(r, 50));
			const input = document.querySelector('#editTimerForm .choices__input--cloned');
			if (!input || !input.getBoundingClientRect().width) return {error: 'Choices did not become visible', modal: document.querySelector('#TimerModal').className, display: getComputedStyle(document.querySelector('#TimerModal')).display, parent: document.querySelector('#editTimerForm').parentElement.outerHTML.slice(0, 300), ready: document.readyState};
			const dropdown = document.querySelector('#editTimerForm .choices__list--dropdown');
			const choices = document.querySelector('#editTimerForm .choices');
			const dialog = document.querySelector('#TimerModal .modal-dialog');
			await new Promise(r => setTimeout(r, 500));
			const dialogHeight = dialog.getBoundingClientRect().height;
			input.blur();
			timerTagChoices.hideDropdown();
			await new Promise(r => requestAnimationFrame(r));
			const snapshots = [];
			const snapshot = phase => {
				const r = dropdown.getBoundingClientRect(), c = choices.getBoundingClientRect(), s = getComputedStyle(dropdown);
				snapshots.push({phase, left: r.left, top: r.top, bottom: r.bottom, targetLeft: c.left, targetTop: c.bottom, dialogHeight: dialog.getBoundingClientRect().height, position: s.position, visibility: s.visibility, display: s.display, classes: dropdown.className, modalClasses: document.getElementById('TimerModal').className, transform: getComputedStyle(dialog).transform, ancestors: [dialog, dialog.parentElement].map(el => ({classes: el.className, transform: getComputedStyle(el).transform, webkitTransform: getComputedStyle(el).webkitTransform})), offsetParent: dropdown.offsetParent && dropdown.offsetParent.className, styleLeft: dropdown.style.left});
			};
			const watchFrames = async phase => {
				const start = performance.now();
				do {
					await new Promise(r => requestAnimationFrame(r));
					snapshot(phase + ' frame');
				} while (performance.now() - start < 1000);
				snapshot(phase + ' settled');
			};
			const observer = new MutationObserver(() => snapshot('mutation'));
			observer.observe(dropdown, {attributes: true, attributeFilter: ['class', 'style']});
			document.getElementById('tagsnew').addEventListener('showDropdown', () => snapshot('showDropdown'));
			snapshot('before');
			choices.querySelector('.choices__inner').click();
			snapshot('after click');
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			snapshot('after frames');
			await watchFrames('opened');
			input.blur();
			timerTagChoices.hideDropdown();
			for (let n = 0; n < 20 && dropdown.classList.contains('is-active'); n++) await new Promise(r => setTimeout(r, 25));
			snapshot('closed');
			choices.querySelector('.choices__inner').click();
			for (let n = 0; n < 20 && !dropdown.classList.contains('is-active'); n++) await new Promise(r => setTimeout(r, 25));
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
			snapshot('reopened');
			await watchFrames('reopened');
			observer.disconnect();
			return {version: [...document.scripts].map(s => s.src).find(s => s.includes('responsive.min.js')), modalCssPresent: [...document.querySelectorAll('style')].some(style => style.textContent.includes('#TimerModal.timer-tags-open .modal-dialog')), dialogHeight, snapshots};
		})()`);
		assert.ok(!result.error, result.error);
		console.log(JSON.stringify({version: result.version, viewport: {width, height}, frames: result.snapshots.filter(entry => entry.phase.endsWith(' frame')).length, snapshots: result.snapshots.filter(entry => !entry.phase.endsWith(' frame')).map(({phase, left, top, targetLeft, targetTop, visibility, classes, transform}) => ({phase, left, top, targetLeft, targetTop, visibility, classes, transform}))}, null, 2));
		assert.ok(result.version && result.version.includes(process.env['OPENWEBIF_TEST_EXPECT_VERSION'] || 'v1.2.30'), 'Wrong JavaScript version');
		const snapshot = phase => result.snapshots.find(entry => entry.phase === phase);
		for (const phase of ['showDropdown', 'after frames', 'opened settled', 'reopened', 'reopened settled']) {
			const entry = snapshot(phase);
			assert.ok(entry && entry.classes.includes('timer-tags-positioned') && entry.visibility === 'visible', `${phase} not visible after positioning`);
			assert.ok(Math.abs(entry.left - entry.targetLeft) < 1 && Math.abs(entry.top - entry.targetTop) < 1, `${phase} offset from input`);
		}
		for (const entry of result.snapshots.filter(entry => entry.visibility === 'visible' && entry.display !== 'none')) {
			assert.ok(Math.abs(entry.left - entry.targetLeft) < 1 && Math.abs(entry.top - entry.targetTop) < 1, `${entry.phase} offset from input`);
			assert.ok(Math.abs(entry.dialogHeight - result.dialogHeight) < 1, `${entry.phase} resized editor`);
			assert.ok(entry.bottom <= height * 0.9 + 1, `${entry.phase} exceeds viewport limit`);
		}
		assert.ok(snapshot('closed').visibility === 'hidden' && !snapshot('closed').classes.includes('timer-tags-positioned'), 'Closing did not reset dropdown');
	} finally {
		socket.close();
	}
}

if (process.env.OPENWEBIF_ALLOW_HARDWARE_TESTS !== 'YES' || !host || !user || !password) {
	console.log('Live-Geräteprüfung übersprungen: Freigabe, Zieladresse und Zugangsdaten erforderlich.');
} else {
	main().catch(error => { console.error(error); process.exitCode = 1; });
}