const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { before, after, test } = require('node:test');
const { setTimeout: sleep } = require('node:timers/promises');
const { chromium } = require('playwright');

const fixtures = JSON.parse(readFileSync(0, 'utf8'));
const origin = 'http://openwebif.invalid';
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); });

async function waitForDom(page, predicate, argument) {
    // Poll outside the page: its clock is deliberately paused for deterministic interval tests.
    for (let attempt = 0; attempt < 500; attempt++) {
        if (await page.evaluate(predicate, argument)) return;
        await sleep(10);
    }
    assert.fail('DOM did not reach the expected state: ' + predicate);
}

async function openEpg(t, mode = 1, variant = '') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    const unexpected = [];
    const loads = [];
    const assetLoads = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
            unexpected.push(url.href);
            return route.abort();
        }
        if (url.pathname === '/') {
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
                <meta charset="utf-8"><style>${fixtures.css}</style>
                <style>body { margin: 20px; } #epgcard { margin: 0; } .nav-tabs { display: flex; flex-wrap: wrap; }
                #tbl1body td.border { min-width: 220px; height: 240px; } #header { display: block; }</style>
                <script>${fixtures.jquery}</script><script>
                    // Only the surrounding application shell is substituted; EPG scripts and jQuery.load run unchanged.
                    jQuery.fx.off = true;
                    jQuery.AdminBSB = { input: { activate: function() {} } };
                    var loadspinner = '<div id="spinner">Laden</div>', mepgdirect = 0;
                    function load_tvcontent_spin(url) { jQuery('#tvcontent').html(loadspinner).load(url); }
                    function SetLSValue(key, value) { localStorage.setItem(key, value); }
                </script>${fixtures.assetTags}</head><body><div id="header"></div>${fixtures.shell}</body></html>` });
        }
        if (Object.hasOwn(fixtures.assets, url.pathname)) {
            assetLoads.push(url.pathname);
            return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
                body: fixtures.assets[url.pathname] });
        }
        if (url.pathname === '/ajax/multiepg') {
            const day = Number(url.searchParams.get('day') || 0);
            const week = Number(url.searchParams.get('week') || 0);
            const key = `${mode}:${day}:${week}${variant ? ':' + variant : ''}`;
            const markup = fixtures.pages[key];
            assert.ok(markup, 'Missing rendered fixture for ' + key);
            const bouquet = url.searchParams.get('bref');
            if (bouquet) assert.equal(bouquet, fixtures.bouquet);
            loads.push({ mode, day, week });
            return route.fulfill({ contentType: 'text/html', body: markup });
        }
        if (url.pathname === '/api/setwebconfig') {
            mode = Number(url.searchParams.get('mepgmode'));
            assert.ok(mode === 1 || mode === 2);
            return route.fulfill({ json: { result: true } });
        }
        if (url.pathname === '/api/epgcalendar') {
            assert.equal(url.searchParams.get('bref'), fixtures.bouquet);
            return route.fulfill({ json: { result: true, days: ['2026-09-28', '2026-09-29', '2026-10-05'] } });
        }
        if (url.pathname === '/picon.png') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="30"/>' });
        unexpected.push(url.href);
        return route.abort();
    });
    await page.clock.install({ time: fixtures.now - 1000 });
    await page.clock.pauseAt(fixtures.now);
    await page.addInitScript(() => {
        // Observe real interval lifecycle without replacing callbacks or EPG behaviour.
        window.epgIntervals = new Set();
        const start = window.setInterval;
        const stop = window.clearInterval;
        window.setInterval = function(callback, delay, ...args) {
            const id = start(callback, delay, ...args);
            if (delay === 10000) window.epgIntervals.add(id);
            return id;
        };
        window.clearInterval = function(id) { window.epgIntervals.delete(id); return stop(id); };
    });
    t.after(() => {
        assert.deepEqual(errors, [], 'Browser script errors');
        assert.deepEqual(unexpected, [], 'Unexpected or external requests');
        assert.deepEqual(assetLoads.sort(), Object.keys(fixtures.assets).sort(), 'EPG assets load once, not on every AJAX refresh');
    });
    await page.goto(origin);
    await page.waitForSelector('#fulltbl');
    await page.clock.runFor(200);
    return { page, loads };
}

async function navigate(page, selector, expectedMode, expectedOffset) {
    await page.evaluate(() => { window.previousEpgTable = document.getElementById('fulltbl'); });
    await page.locator(selector).click({ force: true });
    await waitForDom(page, ({ mode, offset, midnight }) => {
        const table = document.getElementById('fulltbl');
        return table && table !== window.previousEpgTable &&
            table.classList.contains('epg__tv-guide') === (mode === 1) &&
            Number(table.dataset.slotStart) === midnight + offset * 86400;
    }, { mode: expectedMode, offset: expectedOffset, midnight: fixtures.midnight });
    await page.clock.runFor(200);
}

async function markerPosition(page, mode) {
    return page.locator(mode === 1 ? '.epg__tv-guide-now' : '.timetable-now').evaluate(node =>
        parseFloat(node.style[node.classList.contains('timetable-now') ? 'left' : 'top']));
}

async function intervalCount(page) { return page.evaluate(() => window.epgIntervals.size); }

for (const mode of [1, 2]) {
    const view = mode === 1 ? 'Zeitschrift' : 'Zeitstrahl';
    test(`${view}: externe Styles bleiben auf das EPG begrenzt und Konfiguration wird nicht als Skript ausgeführt`, async t => {
        const { page } = await openEpg(t, mode, 'hostile');
        const config = await page.locator('#modern-epg').evaluate(node => JSON.parse(node.dataset.epgConfig));
        assert.equal(config.currentServiceRef, fixtures.configProbe);
        assert.equal(config.bref, await page.locator('.bq').first().getAttribute('data-ref'));
        assert.equal(decodeURIComponent(config.bref), fixtures.bouquet);
        assert.equal(await page.evaluate(() => window.configInjected), undefined);
        assert.ok((await page.locator(mode === 1 ? '.epg__title' : '.ename').first().textContent()).includes('Sendung 0 <Live> & "Musik"'));
        const channel = page.locator(mode === 1 ? '.serviceheader' : '.epg__channel-col').first();
        assert.equal(await channel.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(186, 186, 186)');
        await page.evaluate(() => document.body.classList.add('theme--city-lights'));
        await waitForDom(page, selector => getComputedStyle(document.querySelector(selector)).backgroundColor === 'rgb(49, 52, 67)',
            mode === 1 ? '.serviceheader' : '.epg__channel-col');
        assert.equal(await channel.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(49, 52, 67)');
        await page.evaluate(() => {
            const table = document.createElement('table');
            table.id = 'unrelated-table';
            document.body.append(table);
        });
        assert.notEqual(await page.locator('#unrelated-table').evaluate(node => getComputedStyle(node).fontSize), '13px');
    });

    test(`${view}: vollständiges Rendering, wiederholte Jetzt-Aktualisierung und aktueller Jetzt-Sprung`, async t => {
        const { page } = await openEpg(t, mode);
        assert.equal(await intervalCount(page), 1);
        assert.equal(await page.locator('#modern-epg style').count(), 0);
        assert.equal(await page.locator('#modern-epg .event').first().evaluate(node => getComputedStyle(node).cursor), 'pointer');
        assert.equal(await page.locator(mode === 1 ? '.serviceheader' : '.epg__timeline-row').count(), 2);
        assert.equal(await page.locator('[data-id="1"]').count(), 2);
        const initial = await markerPosition(page, mode);
        for (let tick = 0; tick < 3; tick++) {
            const previous = await markerPosition(page, mode);
            await page.clock.runFor(10000);
            assert.ok(await markerPosition(page, mode) > previous, 'Marker must advance on every tick');
        }
        assert.ok(await markerPosition(page, mode) > initial);
        const stale = await markerPosition(page, mode);
        await page.clock.setSystemTime(fixtures.now + 3 * 3600 * 1000);
        assert.equal(await markerPosition(page, mode), stale, 'No interval has fired after the clock change');
        await page.locator('[data-day="200"]').click({ force: true });
        const position = await page.locator('#fulltbl').evaluate((table, mode) => {
            if (mode === 2) return { actual: table.scrollLeft, expected: (Date.now() / 1000 - Number(table.dataset.first)) / 6 - 20 };
            const rows = table.querySelectorAll('#tbl1body tr');
            const elapsed = Date.now() / 1000 - Number(table.dataset.slotStart);
            const row = rows[Math.floor(elapsed / 7200)];
            return { actual: table.scrollTop, expected: row.getBoundingClientRect().top - table.getBoundingClientRect().top +
                table.scrollTop + row.getBoundingClientRect().height * (elapsed % 7200) / 7200 -
                table.querySelector('.serviceheader').getBoundingClientRect().height };
        }, mode);
        assert.ok(Math.abs(position.actual - position.expected) < 2, JSON.stringify(position));
    });

    test(`${view}: Tageswechsel, Uhrzeit-Auswahl und unsichtbare Jetzt-Markierung außerhalb von heute`, async t => {
        const { page, loads } = await openEpg(t, mode);
        await navigate(page, '[data-day="1"]', mode, 1);
        assert.equal(await intervalCount(page), 0);
        assert.equal(await page.locator('[data-day="200"]').count(), 0);
        assert.ok((await page.locator('#epg-date-range').textContent()).includes('29.Sep 2026'));
        for (const [selector, hour] of [['#pt0', 6], ['#pt1', 12], ['#pt2', 20]]) {
            assert.equal(Number(await page.locator(selector).getAttribute('data-time')), fixtures.midnight + 86400 + hour * 3600);
            await page.locator(selector).click({ force: true });
            assert.ok(await page.locator('#fulltbl').evaluate(table => Math.max(table.scrollTop, table.scrollLeft)) > 0);
        }
        assert.equal(loads.length, 2, 'Time jumps must scroll, not reload the page');
        if (mode === 2) assert.equal(await page.locator('.timetable-now').evaluate(node => node.style.height), '0px');
        else assert.equal(await page.locator('.epg__tv-guide-now').count(), 0);
    });

    test(`${view}: wiederholtes Nachladen und Verlassen räumen Intervalle und Handler auf`, async t => {
        const { page } = await openEpg(t, mode);
        for (let reload = 0; reload < 3; reload++) {
            await page.evaluate(() => {
                window.previousEpgTable = document.getElementById('fulltbl');
                jQuery('#tvcontent').html(loadspinner).load(window.previousEpgTable.dataset.refreshUrl);
            });
            await waitForDom(page, () => document.getElementById('fulltbl') && document.getElementById('fulltbl') !== window.previousEpgTable);
            await page.clock.runFor(200);
            assert.equal(await intervalCount(page), 1);
            const handlers = await page.evaluate(() => (jQuery._data(window, 'events').resize || []).filter(event => event.namespace === 'epgNowMarker').length);
            assert.equal(handlers, 1);
        }
        await page.evaluate(() => {
            window.removedMarker = document.querySelector('.epg__tv-guide-now, .timetable-now');
            window.removedStyle = window.removedMarker.getAttribute('style');
            jQuery('#tvcontent').html('<p id="other-view" class="event">Andere Ansicht</p>');
        });
        assert.equal(await intervalCount(page), 0);
        assert.equal(await page.locator('#other-view').evaluate(node => getComputedStyle(node).cursor), 'auto', 'EPG styles must not leak into other views');
        const handlers = await page.evaluate(() => Object.values(jQuery._data(window, 'events') || {}).flat()
            .filter(event => /^epg/.test(event.namespace)).length);
        assert.equal(handlers, 0, 'EPG window handlers must be removed on leaving the view');
        await page.clock.runFor(30000);
        assert.equal(await page.evaluate(() => window.removedMarker.getAttribute('style')), await page.evaluate(() => window.removedStyle));
        await page.evaluate(() => load_tvcontent_spin('ajax/multiepg?epgmode=tv'));
        await page.waitForSelector('#fulltbl');
        assert.equal(await intervalCount(page), 1);
    });

    test(`${view}: Kalender lädt neue gerenderte Tagesdaten und setzt die Woche zurück`, async t => {
        const { page, loads } = await openEpg(t, mode);
        if (mode === 2) {
            await page.locator('[data-day="101"]').click({ force: true });
            await page.waitForSelector('.epg__tv-guide');
        }
        await navigate(page, '[data-day="1001"]', 1, 7);
        if (mode === 2) await navigate(page, '[data-day="102"]', 2, 7);
        await page.locator('#epg-calendar-toggle').click({ force: true });
        await page.locator('#epg-calendar-prev').click({ force: true });
        await waitForDom(page, () => document.querySelectorAll('#epg-calendar-grid button.has-epg').length === 2);
        await page.evaluate(() => { window.previousEpgTable = document.getElementById('fulltbl'); });
        await page.locator('#epg-calendar-grid button').filter({ hasText: /^29$/ }).click({ force: true });
        await waitForDom(page, () => document.getElementById('fulltbl') && document.getElementById('fulltbl') !== window.previousEpgTable);
        assert.deepEqual(loads.at(-1), { mode, day: 1, week: 0 });
        assert.equal(Number(await page.locator('#fulltbl').getAttribute('data-slot-start')), fixtures.midnight + 86400);
    });

    test(`${view}: Seiten-Lebenszyklus stoppt und startet die Jetzt-Aktualisierung ohne Duplikate`, async t => {
        const { page } = await openEpg(t, mode);
        const previous = await markerPosition(page, mode);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        assert.equal(await intervalCount(page), 0);
        await page.clock.runFor(20000);
        assert.equal(await markerPosition(page, mode), previous);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        assert.equal(await intervalCount(page), 1);
        assert.ok(await markerPosition(page, mode) > previous);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        assert.equal(await intervalCount(page), 1);
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
        assert.equal(await intervalCount(page), 0);
    });
}

test('Wochen- und Ansichtswechsel behalten Bezugstag, sichtbare Sendungen und Uhrzeit-Sprünge', async t => {
    const { page, loads } = await openEpg(t);
    for (const week of [1, 2]) {
        await navigate(page, `[data-day="${1000 + week}"]`, 1, week * 7);
        assert.equal(await intervalCount(page), 0);
        await navigate(page, '[data-day="102"]', 2, week * 7);
        assert.equal(Number(await page.locator('#fulltbl').getAttribute('data-first')), fixtures.midnight + week * 7 * 86400);
        const event = page.locator('.eventlist .event[data-id="1"]').first();
        const tableBounds = await page.locator('#fulltbl').boundingBox();
        const eventBounds = await event.boundingBox();
        assert.ok(eventBounds.x < tableBounds.x + tableBounds.width && eventBounds.x + eventBounds.width > tableBounds.x + 140,
            'First event of the selected week must be in the visible timeline');
        assert.equal(await intervalCount(page), 0);
        await page.locator('#pt1').click({ force: true });
        assert.equal(await page.locator('#fulltbl').evaluate(table => table.scrollLeft), 7180);
        await navigate(page, '[data-day="101"]', 1, week * 7);
        assert.equal(await page.locator('.serviceheader .event').first().evaluate(node => getComputedStyle(node).display), 'block',
            'Timeline event styles must not carry over to the magazine');
    }
    assert.deepEqual(loads.map(load => load.mode), [1, 1, 2, 1, 1, 2, 1]);
});

test('Ansichtswechsel mit gewähltem Tag erhält Tag und Woche; Rückkehr nach heute startet genau einen Marker', async t => {
    const { page, loads } = await openEpg(t);
    await navigate(page, '[data-day="1001"]', 1, 7);
    await navigate(page, '[data-day="2"]', 1, 9);
    await navigate(page, '[data-day="102"]', 2, 9);
    assert.equal(Number(await page.locator('#fulltbl').getAttribute('data-first')), fixtures.midnight + 9 * 86400);
    assert.deepEqual(loads.at(-1), { mode: 2, day: 2, week: 1 });
    await navigate(page, '[data-day="101"]', 1, 9);
    await navigate(page, '[data-day="0"]', 1, 7);
    await page.locator('[data-day="1000"]').click({ force: true });
    await page.waitForSelector('.epg__tv-guide-now');
    assert.equal(await intervalCount(page), 1);
    await page.locator('[data-day="102"]').click({ force: true });
    await page.waitForSelector('.timetable-now');
    assert.equal(await intervalCount(page), 1);
    const previous = await markerPosition(page, 2);
    await page.clock.runFor(30000);
    assert.ok(await markerPosition(page, 2) > previous);
});