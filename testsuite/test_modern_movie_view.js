const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'sourcefiles/modern/js/responsive.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'plugin/controllers/views/responsive/ajax/movies.tmpl'), 'utf8');

test('Der Ansichtsschalter steht nach dem Filter und zeigt die gewünschten Icons', () => {
	const filter = template.indexOf('data-tag-filter-toggle="movies"');
	const view = template.indexOf('class="list-tag-filter-toggle movies-view-toggle"');
	const refresh = template.indexOf('refreshMoviesView()');
	assert.ok(filter !== -1 && filter < view && view < refresh);
	assert.match(template, /data-icon="ic:sharp-account-tree"/);
	assert.match(template, /data-icon="ic:sharp-view-list"/);
	assert.match(template, /data-view="list"[^>]*aria-pressed="true"/);
	assert.match(template, /data-view="folders"[^>]*aria-pressed="false"/);
	assert.match(template, /class="movie-recording-path"[^>]*>\$escape\(\$dirname\(\$movie\.filename\)\)/);
	assert.match(template, /data-movie-directory="\$escape\(\$path, quote=True\)"/);
	assert.match(template, /openMoviesDirectory\(this\.value\)/);
});

test('Liste und Ordneransicht behalten den gewählten Ordner bei Navigation und Sortieren', () => {
	const start = script.indexOf('function moviesViewUrl(');
	const end = script.indexOf('function changeMoviesortSearch(', start);
	assert.ok(start !== -1 && end > start);
	let url;
	const button = {dataset: {directory: '/media/hdd/Film + Serien/', view: 'folders'}};
	const context = {
		URLSearchParams,
		document: {querySelector: () => button},
		load_maincontent_spin: value => { url = value; },
		load_maincontent_spin_force: value => { url = value; },
		MLHelper: {SortMovies() {}, ChangeSort() {}, ReadMovies() {}},
	};
	vm.runInNewContext(script.slice(start, end), context);
	assert.equal(context.moviesViewUrl('/media/hdd/Film + Serien/', false), 'ajax/movies?dirname=%2Fmedia%2Fhdd%2FFilm+%2B+Serien%2F');
	assert.equal(context.moviesViewUrl('/media/hdd/Film + Serien/', true), 'ajax/movies?dirname=%2Fmedia%2Fhdd%2FFilm+%2B+Serien%2F&recursive=1');
	context.toggleMoviesView();
	assert.equal(url, context.moviesViewUrl(button.dataset.directory, true));
	button.dataset.view = 'list';
	context.openMoviesDirectory('/media/hdd/Film + Serien/Staffel 1/');
	assert.equal(url, context.moviesViewUrl('/media/hdd/Film + Serien/Staffel 1/', true));
	context.refreshMoviesView();
	assert.equal(url, context.moviesViewUrl(button.dataset.directory, true));
	context.changeMoviesort('dated');
	assert.equal(url, context.moviesViewUrl(button.dataset.directory, true));
	context.toggleMoviesView();
	assert.equal(url, context.moviesViewUrl(button.dataset.directory, false));
});