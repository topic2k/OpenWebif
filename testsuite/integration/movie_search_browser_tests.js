const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright');

const fixtures = JSON.parse(readFileSync(0, 'utf8'));
const origin = 'http://openwebif.invalid';
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); });

for (const compact of [false, true]) {
	for (const width of [1280, 375]) {
		test(`Aufnahmensuche im Browser: compact=${compact}, width=${width}`, async t => {
			const page = await browser.newPage({ viewport: { width, height: 900 } });
			page.setDefaultTimeout(5000);
			t.after(() => page.close());
			const errors = [];
			const unexpected = [];
			const requests = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.route('**/*', async route => {
				const url = new URL(route.request().url());
				if (url.origin === origin && Object.hasOwn(fixtures.assets, url.pathname)) {
					return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
						body: fixtures.assets[url.pathname] });
				}
				if (url.origin === origin && url.pathname === '/') {
					return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8">
						<link rel="stylesheet" href="/modern/plugins/bootstrap/css/bootstrap.min.css">
						<link rel="stylesheet" href="/modern/css/style.min.css">
						<link rel="stylesheet" href="/modern/css/responsive.min.css">
						<style>body { padding: 20px; font-family: Arial, sans-serif; } .material-icons { font-family: Arial, sans-serif; }</style>
						<script src="/js/jquery-2.2.4.min.js"></script><script>
							// Substitute only unrelated application-shell collaborators, not search or jQuery.load.
							var lastcontenturl = '', loadspinner = '<p>Laden</p>', timeredit_initialized = true;
							function autosize() {}
							var sortCalls = [];
							var MLHelper = { Load() {}, ReadMovies() {}, ChangeSort() {}, SortMovies(sort) { sortCalls.push(sort); } };
							function owifRequestUrl(url) { return url; }
						</script><script src="/modern/js/responsive.min.js"></script>
						<script>getStatusInfo = function() {}; jQuery.Tools = { epgsearch: { activate() {} } };</script>
						</head><body class="theme--supabright"><div id="content_container"></div></body></html>` });
				}
				if (url.origin === origin && ['/ajax/movies', '/ajax/moviesearch'].includes(url.pathname)) {
					requests.push(url);
					assert.equal(url.searchParams.get('dirname'), fixtures.directory);
					let markup = fixtures.pages.movies;
					if (url.pathname === '/ajax/moviesearch') {
						const term = url.searchParams.get('find');
						assert.ok([fixtures.term, 'kein Treffer'].includes(term));
						markup = term === 'kein Treffer' ? fixtures.pages.empty : fixtures.pages[compact ? 'True' : 'False'];
					}
					return route.fulfill({ contentType: 'text/html', body: markup });
				}
				if (url.origin === origin && url.pathname === '/api/tagfiltertags') {
					return route.fulfill({ json: { known: ['Film_&_Serie'], used: [] } });
				}
				unexpected.push(url.href);
				return route.abort();
			});
			await page.goto(origin);
			await page.evaluate(directory => load_maincontent_spin_force(moviesViewUrl(directory, false)), fixtures.directory);
			await page.waitForSelector('#movie-search-text');
			await page.locator('#movie-search-text').fill('  ' + fixtures.term + '  ');
			const searched = page.waitForResponse(response => response.url().includes('/ajax/moviesearch?'));
			await page.locator('#movie-search-form button[type="submit"]').click();
			await searched;
			await page.waitForFunction(term => document.querySelector('#movie-search-form')?.dataset.search === term, fixtures.term);
			assert.equal(await page.locator('#movie-search-text').inputValue(), fixtures.term);
			assert.equal(await page.locator('[role="status"]').textContent(), '1 Treffer');
			assert.equal(await page.locator('.row-striped').count(), compact ? 1 : 0);
			assert.equal(await page.locator('Titel').count(), 0);
			assert.deepEqual(errors, [], 'Browserfehler vor der Filterinitialisierung');
			await page.waitForFunction(() => typeof document.querySelector('[data-tag-filter-toggle="movies"]')?.onclick === 'function');
			assert.deepEqual(errors, [], 'Browserfehler nach dem Rendern');
			await page.locator('[data-tag-filter-toggle="movies"]').click();
			assert.deepEqual(unexpected, [], 'Unerwartete Anfragen nach dem Rendern');
			await page.locator('.list-tag-filter-options label').click();
			assert.equal(await page.locator('.list-tag-filter-options input').isChecked(), true);
			assert.equal(await page.locator('.list-tag-filter-item:visible').count(), 1);
			await page.locator('#movie-search-text').fill('Nicht abgesendet');
			const refreshed = page.waitForResponse(response => response.url().includes('/ajax/moviesearch?'));
			await page.locator('[onclick="refreshMoviesView(); return false;"]').click();
			await refreshed;
			await page.waitForFunction(term => document.querySelector('#movie-search-text')?.value === term, fixtures.term);
			assert.equal(requests.at(-1).searchParams.get('find'), fixtures.term);
			const sorted = page.waitForResponse(response => response.url().includes('/ajax/moviesearch?'));
			await page.locator('[onclick="changeMoviesortSearch(\'dated\'); return false;"]').evaluate(element => element.click());
			await sorted;
			await page.waitForSelector('#movie-search-text');
			assert.deepEqual(await page.evaluate(() => sortCalls), ['dated']);
			await page.locator('#movie-search-text').fill('kein Treffer');
			await page.locator('#movie-search-text').press('Enter');
			await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent === '0 Treffer');
			assert.equal(await page.locator('.list-tag-filter-item').count(), 0);
			await page.locator('[onclick="clearMoviesSearch(); return false;"]').click();
			await page.waitForSelector('.movies-view-toggle');
			assert.equal(await page.locator('#movie-search-text').inputValue(), '');
			assert.equal(requests.at(-1).pathname, '/ajax/movies');
			assert.equal(requests.at(-1).searchParams.get('recursive'), null);
			assert.deepEqual(errors, [], 'Browserfehler');
			assert.deepEqual(unexpected, [], 'Unerwartete oder externe Anfragen');
		});
	}
}