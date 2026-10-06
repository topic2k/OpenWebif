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
                #tbl1body td.border { min-width: 220px; } #header { display: block; }</style>
                <script>${fixtures.jquery}</script><script>
                    // Only the surrounding application shell is substituted; EPG scripts and jQuery.load run unchanged.
                    jQuery.fx.off = true;
                    jQuery.AdminBSB = { input: { activate: function() {} } };
                    var loadspinner = '<div id="spinner">Laden</div>', mepgdirect = 0;
                    function load_tvcontent_spin(url) { jQuery('#tvcontent').html(loadspinner).load(url); }
                    function SetLSValue(key, value) { localStorage.setItem(key, value); }
                    window.eventCalls = []; window.modalCalls = [];
                    function loadeventepg(id, ref) { window.eventCalls.push({ id, ref }); }
                    jQuery.fn.modal = function(action, node) { window.modalCalls.push(node.dataset.metadata); return this; };
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
            const bouquet = url.searchParams.get('bref');
            if (bouquet) assert.ok([fixtures.bouquet, fixtures.otherBouquet].includes(bouquet));
            const key = `${mode}:${day}:${week}${variant ? ':' + variant : ''}${bouquet === fixtures.otherBouquet ? ':other' : ''}`;
            const markup = fixtures.pages[key];
            assert.ok(markup, 'Missing rendered fixture for ' + key);
            loads.push({ mode, day, week });
            return route.fulfill({ contentType: 'text/html', body: markup });
        }
        if (url.pathname === '/api/setwebconfig') {
            mode = Number(url.searchParams.get('mepgmode'));
            assert.ok(mode === 1 || mode === 2);
            return route.fulfill({ json: { result: true } });
        }
        if (url.pathname === '/api/epgcalendar') {
            assert.ok([fixtures.bouquet, fixtures.otherBouquet].includes(url.searchParams.get('bref')));
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
    await waitForDom(page, () => parseFloat(document.getElementById('fulltbl')?.style.height) > 0);
    await page.clock.runFor(200);
    t.after(() => context.close());
    return { page, loads };
}

async function navigate(page, selector, expectedMode, expectedOffset) {
    await page.evaluate(() => { window.previousEpgTable = document.getElementById('fulltbl'); });
    await page.locator(selector).click({ force: true });
    await waitForDom(page, ({ mode, offset, midnight }) => {
        const table = document.getElementById('fulltbl');
        return table && parseFloat(table.style.height) > 0 && table !== window.previousEpgTable &&
            table.classList.contains('epg__tv-guide') === (mode === 1) &&
            Number(table.dataset.slotStart) === midnight + offset * 86400 + (mode === 1 && offset === 0 ? 20 * 3600 : 0);
    }, { mode: expectedMode, offset: expectedOffset, midnight: fixtures.midnight });
    await page.clock.runFor(200);
}

async function markerPosition(page, mode) {
    return page.locator(mode === 1 ? '.epg__tv-guide-now' : '.timetable-now').evaluate(node =>
        parseFloat(node.style[node.classList.contains('timetable-now') ? 'left' : 'top']));
}

async function intervalCount(page) { return page.evaluate(() => window.epgIntervals.size); }

test('Zeitstrahl: viele Sendungen behalten Zeitposition und Breite auch ohne Vorgänger', async t => {
    const { page } = await openEpg(t, 2);
    async function checkGeometry() {
        const geometry = await page.locator('.eventlist').first().evaluate(list => {
            const origin = list.getBoundingClientRect().left;
            return Array.from(list.querySelectorAll('.event[data-begin]'), event => {
                const rect = event.getBoundingClientRect();
                return { id: Number(event.dataset.id), left: rect.left - origin, width: rect.width };
            });
        });
        assert.ok(geometry.length > 10);
        for (const event of geometry) {
            assert.ok(Math.abs(event.left - (event.id - 1) * 600) < 0.1, JSON.stringify(event));
            assert.ok(Math.abs(event.width - 600) < 0.1, JSON.stringify(event));
        }
    }
    await checkGeometry();
    await page.locator('.eventlist').first().evaluate(list => {
        list.querySelectorAll('.event').forEach((event, index) => { if (index % 3 === 0) event.remove(); });
    });
    await checkGeometry();
});

async function checkTimelineWidth(page) {
    const geometry = await page.locator('#fulltbl').evaluate(table => {
        const width = (Number(table.dataset.timelineEnd) - Number(table.dataset.first)) / 6;
        return { actual: table.scrollWidth, expected: Math.max(table.clientWidth, width + 140),
            rows: Array.from(table.querySelectorAll('.epg__timeline-row'), row => row.getBoundingClientRect().width) };
    });
    assert.ok(Math.abs(geometry.actual - geometry.expected) <= 1, JSON.stringify(geometry));
    for (const width of geometry.rows) assert.ok(Math.abs(width - geometry.expected) <= 1, JSON.stringify(geometry));
}

for (const variant of ['geometry', 'long']) {
    test(`Zeitstrahl: tatsächliches Ende ohne Restbereich (${variant})`, async t => {
        const { page } = await openEpg(t, 2, variant);
        await checkTimelineWidth(page);
        const last = await page.locator('.eventlist').first().evaluate(list => {
            const table = document.getElementById('fulltbl');
            const end = Number(table.dataset.timelineEnd);
            const event = Array.from(list.querySelectorAll('[data-end]')).find(event => Number(event.dataset.end) === end);
            const rect = event.getBoundingClientRect();
            return { right: rect.right - list.getBoundingClientRect().left,
                expected: (end - Number(table.dataset.first)) / 6,
                width: rect.width, begin: Number(event.dataset.begin), end };
        });
        assert.ok(Math.abs(last.right - last.expected) < 0.1, JSON.stringify(last));
        if (variant === 'long') assert.ok(last.width > 30000, 'Long events are not clipped at 50 hours');
        await page.locator('#fulltbl').evaluate(table => { table.scrollLeft = table.scrollWidth; });
        const visibleEnd = await page.locator('.eventlist').first().evaluate(list => {
            const table = document.getElementById('fulltbl');
            const event = Array.from(list.querySelectorAll('[data-end]')).find(event => event.dataset.end === table.dataset.timelineEnd);
            return event.getBoundingClientRect().right - table.getBoundingClientRect().right;
        });
        assert.ok(Math.abs(visibleEnd) <= 1, 'Final event ends at the scroll boundary');
        await page.setViewportSize({ width: 1000, height: 740 });
        await page.clock.runFor(200);
        await checkTimelineWidth(page);
        await navigate(page, '[data-day="1"]', 2, 1);
        await checkTimelineWidth(page);
    });
}

for (const variant of ['short', 'empty']) {
    test(`Zeitstrahl: begrenzte Navigation und Datum bei ${variant}`, async t => {
        const { page } = await openEpg(t, 2, variant);
        await checkTimelineWidth(page);
        assert.equal(await page.locator('.timetable-now').isVisible(), false, 'Now is outside the selected data');
        assert.equal(await page.locator('#epg-date-range').textContent(), 'Mo, 28.Sep 2026');
        for (const selector of ['#pt0', '#pt1', '#pt2', '#pt3']) {
            await page.locator(selector).click({ force: true });
            const scroll = await page.locator('#fulltbl').evaluate(table => ({
                actual: table.scrollLeft, expected: table.scrollWidth - table.clientWidth
            }));
            assert.equal(scroll.actual, scroll.expected, 'A jump after the final event stops at the real boundary');
            await checkTimelineWidth(page);
        }
        await page.evaluate(() => {
            window.previousEpgTable = document.getElementById('fulltbl');
            jQuery('#tvcontent').html(loadspinner).load(window.previousEpgTable.dataset.refreshUrl);
        });
        await waitForDom(page, () => {
            const table = document.getElementById('fulltbl');
            return table && table !== window.previousEpgTable && parseFloat(table.style.height) > 0;
        });
        await page.clock.runFor(200);
        await checkTimelineWidth(page);
        await page.setViewportSize({ width: 1000, height: 740 });
        await page.clock.runFor(200);
        await checkTimelineWidth(page);
        await navigate(page, '[data-day="1"]', 2, 1);
        assert.equal(await page.locator('#epg-date-range').textContent(), 'Di, 29.Sep 2026');
        await checkTimelineWidth(page);
        await page.locator('#epg-calendar-toggle').click({ force: true });
        await waitForDom(page, () => document.querySelectorAll('#epg-calendar-grid button.has-epg').length === 2);
        await page.evaluate(() => { window.previousEpgTable = document.getElementById('fulltbl'); });
        await page.locator('#epg-calendar-grid button').filter({ hasText: /^28$/ }).click({ force: true });
        await waitForDom(page, () => {
            const table = document.getElementById('fulltbl');
            return table && table !== window.previousEpgTable && parseFloat(table.style.height) > 0;
        });
        await page.clock.runFor(200);
        assert.equal(await page.locator('#epg-date-range').textContent(), 'Mo, 28.Sep 2026');
        await checkTimelineWidth(page);
        await page.evaluate(() => { window.previousEpgTable = document.getElementById('fulltbl'); });
        await page.locator('.bq').nth(1).click({ force: true });
        await waitForDom(page, () => {
            const table = document.getElementById('fulltbl');
            return table && table !== window.previousEpgTable && parseFloat(table.style.height) > 0;
        });
        await page.clock.runFor(200);
        await checkTimelineWidth(page);
        assert.equal(await page.locator('#fulltbl').evaluate(table => table.scrollWidth - table.clientWidth), 0);
        assert.equal(await page.locator('.timetable-now').isVisible(), false);
    });
}

test('Zeitstrahl: Enddatum und Jetzt-Markierung erzeugen keinen zusätzlichen Scrollbereich', async t => {
    const { page } = await openEpg(t, 2);
    await page.locator('#fulltbl').evaluate(table => { table.scrollLeft = table.scrollWidth; });
    await page.clock.runFor(200);
    assert.equal(await page.locator('#epg-date-range').textContent(), 'Mo, 28.Sep 2026');
    for (const [timestamp, visible] of [[fixtures.midnight + 86400, false], [fixtures.midnight - 1, false],
        [fixtures.midnight + 3600, true]]) {
        await page.clock.setSystemTime(timestamp * 1000);
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        assert.equal(await page.locator('.timetable-now').isVisible(), visible);
        await checkTimelineWidth(page);
    }
    await page.clock.setSystemTime((fixtures.midnight + 86400 - 1) * 1000);
    await page.clock.runFor(10000);
    assert.equal(await page.locator('.timetable-now').isVisible(), false, 'The regular tick hides Now at the end');
    await checkTimelineWidth(page);
});

for (const mode of [1, 2]) {
    const view = mode === 1 ? 'Zeitschrift' : 'Zeitstrahl';
    test(`${view}: 20:47 liegt bei 32/90 der Sendung 20:15–21:45, unabhängig vom Text`, async t => {
        const { page } = await openEpg(t, mode, 'geometry');
        await page.locator('[data-day="200"]').click({ force: true });
        async function checkAlignment() {
            const geometry = await page.evaluate(mode => {
                const events = Array.from(document.querySelectorAll('[data-id="1001"]'));
                const marker = document.querySelector(mode === 1 ? '.epg__tv-guide-now' : '.timetable-now').getBoundingClientRect();
                const later = document.querySelector('[data-id="1002"]').getBoundingClientRect();
                return events.map(event => {
                    const rect = event.getBoundingClientRect();
                    return mode === 1 ? { position: rect.top, size: rect.height, ratio: (marker.top - rect.top) / rect.height,
                        later: later.top, marker: marker.top } :
                        { position: rect.left, size: rect.width, ratio: (marker.left - rect.left) / rect.width,
                            later: later.left, marker: marker.left };
                });
            }, mode);
            assert.equal(geometry.length, 2, 'A spanning event stays one element per channel');
            assert.equal(geometry[0].position, geometry[1].position, 'Same begin time aligns across channels');
            for (const event of geometry) {
                assert.ok(Math.abs(event.ratio - 32 / 90) < 0.001, JSON.stringify(event));
                assert.equal(event.size, mode === 1 ? 360 : 900);
                assert.ok(event.later > event.marker, '21:45 must be after the 20:47 marker');
            }
        }
        await checkAlignment();
        await page.setViewportSize({ width: 1000, height: 740 });
        await page.clock.runFor(200);
        await checkAlignment();
        const zoom = await page.context().newCDPSession(page);
        await zoom.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.25 });
        await checkAlignment();
        await zoom.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
        await page.locator('[data-id="1001"] .epg__timer-marker').first().click({ force: true });
        assert.equal(await page.evaluate(() => window.modalCalls.length), 1);
        assert.equal(await page.evaluate(() => window.eventCalls.length), 0, 'Timer action must not open the event');
        await page.locator('[data-id="1001"]').first().click({ force: true,
            position: mode === 1 ? { x: 20, y: 340 } : { x: 500, y: 20 } });
        assert.equal(await page.evaluate(() => window.eventCalls.at(-1).id), '1001');
        const metadata = await page.evaluate(() => JSON.parse(window.modalCalls[0]));
        assert.equal(metadata.begin, fixtures.midnight + 20 * 3600 + 15 * 60);
        assert.equal(metadata.end - metadata.begin, 90 * 60);

        const long = page.locator('[data-id="1003"]').first();
        const before = await long.evaluate((event, mode) => {
            const table = document.getElementById('fulltbl');
            const rect = event.getBoundingClientRect(), bounds = table.getBoundingClientRect();
            return mode === 1 ? rect.top - bounds.top + table.scrollTop : rect.left - bounds.left + table.scrollLeft;
        }, mode);
        await page.locator('#fulltbl').evaluate((table, {mode, before}) => {
            if (mode === 1) table.scrollTop = before + 700;
            else table.scrollLeft = before + 900;
            table.dispatchEvent(new Event('scroll'));
        }, { mode, before });
        await page.clock.runFor(200);
        const scrolled = await long.evaluate((event, mode) => {
            const rect = event.getBoundingClientRect(), table = document.getElementById('fulltbl');
            const info = event.querySelector(mode === 1 ? '.epg__event-info' : '.epg__timeline-info');
            const text = info.getBoundingClientRect(), bounds = table.getBoundingClientRect();
            return { transform: event.style.transform, shift: info._epgShift,
                position: mode === 1 ? rect.top - bounds.top + table.scrollTop : rect.left - bounds.left + table.scrollLeft,
                contained: mode === 1 ? text.top >= rect.top && text.bottom <= rect.bottom + 0.1 :
                    text.left >= rect.left && text.right <= rect.right + 0.1 };
        }, mode);
        assert.equal(scrolled.transform, '');
        assert.equal(scrolled.position, before, 'Scroll must not move the time block');
        assert.ok(scrolled.shift > 0, 'Text follows scrolling even when the originating slot is offscreen');
        assert.ok(scrolled.contained, 'Text stays inside the event');

        await page.evaluate(() => {
            const url = document.getElementById('fulltbl').dataset.refreshUrl;
            jQuery('#tvcontent').html(loadspinner).load(url);
        });
        await page.waitForSelector('[data-id="1001"]');
        await page.clock.runFor(200);
        await checkAlignment();
        assert.equal(await intervalCount(page), 1);
        await page.locator(`[data-day="${mode === 1 ? 102 : 101}"]`).click({ force: true });
        await page.waitForSelector(mode === 1 ? '.epg__timeline' : '.epg__tv-guide');
        await page.clock.runFor(200);
        await page.locator(`[data-day="${mode === 1 ? 101 : 102}"]`).click({ force: true });
        await page.waitForSelector(mode === 1 ? '.epg__tv-guide' : '.epg__timeline');
        await page.clock.runFor(200);
        await checkAlignment();
        assert.equal(await intervalCount(page), 1);
    });

    test(`${view}: Lücken, kurze Sendungen sowie Slot- und Tagesgrenzen behalten ihren Maßstab`, async t => {
        const { page } = await openEpg(t, mode, 'geometry');
        const geometry = await page.evaluate(mode => {
            const size = event => { const rect = event.getBoundingClientRect(); return mode === 1 ? rect.height : rect.width; };
            const firstChannel = Array.from(mode === 1 ? document.querySelectorAll('#tbl1body tr td:first-child [data-id]') :
                document.querySelector('.eventlist').querySelectorAll('[data-id]')).filter(event => Number(event.dataset.id) >= 1100);
            return { clipped: size(document.querySelector('[data-id="1000"]')),
                last: size(document.querySelector('[data-id="1004"]')),
                spanning: size(document.querySelector('[data-id="1003"]')),
                events: firstChannel.map(event => {
                    const rect = event.getBoundingClientRect();
                    return { id: Number(event.dataset.id), position: mode === 1 ? rect.top : rect.left, size: size(event) };
                }), secondCount: Array.from(mode === 1 ? document.querySelectorAll('#tbl1body tr td:nth-child(2) [data-id]') :
                    document.querySelectorAll('.eventlist')[1].querySelectorAll('[data-id]')).filter(event => Number(event.dataset.id) >= 1100).length,
                empty: Array.from(document.querySelectorAll('.epg__slot')).filter(slot => !slot.querySelector('.event')).length };
        }, mode);
        assert.equal(geometry.clipped, mode === 1 ? 40 : 100);
        assert.equal(geometry.last, mode === 1 ? 60 : 600);
        assert.equal(geometry.spanning, mode === 1 ? 1200 : 3000);
        assert.equal(geometry.events.length, 80);
        assert.equal(geometry.secondCount, 40, 'Different event counts must not change the scale');
        const first = geometry.events[0];
        for (const event of geometry.events) {
            assert.ok(Math.abs(event.position - first.position - (event.id - first.id) * (mode === 1 ? 20 : 50)) < 0.1);
            assert.equal(event.size, mode === 1 ? 12 : 30, 'Text must not enlarge short time blocks');
        }
        if (mode === 1) assert.ok(geometry.empty > 0, 'Empty slots remain empty time surfaces');
    });

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
            if (mode === 2) return { actual: table.scrollLeft,
                expected: Math.min(table.scrollWidth - table.clientWidth,
                    Math.max(0, (Date.now() / 1000 - Number(table.dataset.first)) / 6 - 20)) };
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
        assert.equal(await page.locator('[data-day="200"]').isVisible(), true);
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

    test(`${view}: Jetzt kehrt aus Tages- und Wochenauswahl zur aktuellen Uhrzeit zurück`, async t => {
        const { page, loads } = await openEpg(t, mode);
        async function returnToNow() {
            assert.equal(await page.locator('#pt4').isVisible(), true);
            const before = loads.length;
            await navigate(page, '#pt4', mode, 0);
            assert.equal(loads.length, before + 1, 'Exactly one load returns to today');
            assert.deepEqual(loads.at(-1), { mode, day: 0, week: 0 });
            assert.equal(await intervalCount(page), 1);
            const position = await page.locator('#fulltbl').evaluate((table, mode) => {
                const expected = mode === 1 ? (Date.now() / 1000 - Number(table.dataset.slotStart)) / 15 :
                    (Date.now() / 1000 - Number(table.dataset.first)) / 6 - 20;
                return { actual: mode === 1 ? table.scrollTop : table.scrollLeft, expected };
            }, mode);
            assert.ok(Math.abs(position.actual - position.expected) < 2, JSON.stringify(position));
            await page.locator('#pt4').click({ force: true });
            assert.equal(loads.length, before + 1, 'On today, Now only scrolls');
        }
        await navigate(page, '[data-day="1"]', mode, 1);
        await returnToNow();
        if (mode === 2) await navigate(page, '[data-day="101"]', 1, 0);
        await navigate(page, '[data-day="1001"]', 1, 7);
        await navigate(page, '[data-day="2"]', 1, 9);
        if (mode === 2) await navigate(page, '[data-day="102"]', 2, 9);
        await returnToNow();
        await page.locator('#epg-calendar-toggle').click({ force: true });
        await waitForDom(page, () => document.querySelectorAll('#epg-calendar-grid button.has-epg').length === 2);
        await navigate(page, '#epg-calendar-grid button:text-is("29")', mode, 1);
        await returnToNow();
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