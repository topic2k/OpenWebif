const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const root = join(__dirname, '../..');
const script = readFileSync(join(root, 'plugin/public/modern/js/responsive.min.js'), 'utf8');
const spinner = script.match(/function SetSpinner\(\)[\s\S]*?(?=function listTimers\()/)[0];
const dialog = script.match(/function load_reboot_dialog\([\s\S]*?(?=function toggleLeftSideBar\()/)[0];
const template = readFileSync(join(root, 'plugin/controllers/views/responsive/main.tmpl'), 'utf8');
const loaderStyle = template.match(/<style>\s*(\.page-loader-wrapper \{[^}]*\})\s*<\/style>/)[1];

test('Neustart-Karte ist in hellen und dunklen Themes auf Desktop und Mobilgeräten lesbar', async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		for (const theme of ['supabright', 'city-lights', 'neon-blackout']) {
			for (const viewport of [{ width: 1280, height: 720 }, { width: 320, height: 568 }, { width: 568, height: 160 }]) {
				const page = await browser.newPage({ viewport });
				await page.route('**/*', route => route.abort());
				await page.setContent('<body class="theme--' + theme + ' skin--blue"><div class="card" id="reference">Aktuelle Seite</div><div id="responsivespinner"></div><div id="general-loader"></div></body>');
				for (const file of ['plugins/bootstrap/css/bootstrap.min.css', 'css/style.min.css', 'css/themes/all-themes.min.css', 'css/responsive.min.css']) {
					await page.addStyleTag({ path: join(root, 'plugin/public/modern', file) });
				}
				await page.addStyleTag({ content: loaderStyle });
				await page.evaluate(() => Promise.all(document.getAnimations()
					.filter(animation => animation instanceof CSSTransition)
					.map(animation => animation.finished)));
				await page.addScriptTag({ path: join(root, 'plugin/public/js/jquery-2.2.4.min.js') });
				await page.addScriptTag({ content: 'var tstr_loading = "Lade";\n' + spinner + dialog });
				for (const title of ['Receiver neu starten', 'Benutzeroberfläche neu starten', 'SehrLangerNeustartHinweis'.repeat(10)]) {
					const result = await page.evaluate(title => {
						SetSpinner();
						load_reboot_dialog(loadspinner, title);
						const wrapper = document.querySelector('#responsivespinner .page-loader-wrapper');
						const card = wrapper.querySelector('.card');
						const bounds = card.getBoundingClientRect();
						const style = getComputedStyle(card);
						document.querySelector('#general-loader').innerHTML = loadspinner;
						return {
							background: style.backgroundColor,
							reference: getComputedStyle(document.querySelector('#reference')).backgroundColor,
							opacity: getComputedStyle(wrapper).opacity,
							position: getComputedStyle(wrapper).position,
							animation: getComputedStyle(card.querySelector('.preloader')).animationName,
							texts: Array.from(card.querySelectorAll('p'), p => p.textContent),
							centerX: bounds.x + bounds.width / 2,
							centerY: bounds.y + bounds.height / 2,
							width: bounds.width,
							height: bounds.height,
							overflows: card.scrollWidth > card.clientWidth,
							generalOpacity: getComputedStyle(document.querySelector('#general-loader .page-loader-wrapper')).opacity,
							generalCard: !!document.querySelector('#general-loader .card'),
						};
					}, title);
					assert.equal(result.background, result.reference, JSON.stringify({ theme, viewport, result }));
					assert.notEqual(result.background, 'rgba(0, 0, 0, 0)');
					assert.equal(result.opacity, '1');
					assert.equal(result.position, 'fixed');
					assert.notEqual(result.animation, 'none');
					assert.deepEqual(result.texts, ['Lade...', title]);
					assert.ok(Math.abs(result.centerX - viewport.width / 2) < 1);
					assert.ok(Math.abs(result.centerY - viewport.height / 2) < 1);
					assert.ok(result.width <= viewport.width - 32);
					assert.ok(result.height <= viewport.height - 32);
					assert.equal(result.overflows, false);
					assert.equal(result.generalOpacity, '0.8');
					assert.equal(result.generalCard, false);
				}
				await page.close();
			}
		}
	} finally {
		await browser.close();
	}
});