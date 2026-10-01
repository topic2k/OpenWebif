const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const config = require('../sourcefiles/modern/webpack.config.js')({}, {mode: 'production'});
const sourcePath = path.join(root, 'sourcefiles/modern/js/tagmanager.js');

test('Der Produktions-Build erzeugt das JavaScript der Stichwortverwaltung aus einer Quelldatei', () => {
	assert.ok(config.entry.legacy.includes(sourcePath), 'Tag manager must survive output.clean via a build entry');
	const rule = config.module.rules.find(rule => rule.type === 'asset/resource' && rule.include.includes(sourcePath));
	assert.ok(rule, 'Tag manager must be emitted as a globally callable script');
	const filename = rule.generator.filename.replace('[name]', 'tagmanager').replace('[ext]', '.js');
	const template = fs.readFileSync(path.join(root, 'plugin/controllers/views/responsive/ajax/tagmanager.tmpl'), 'utf8');
	assert.ok(template.includes(config.output.publicPath + filename + '?'), 'Template must load the emitted asset');
	for (const file of [sourcePath, path.join(config.output.path, filename)]) {
		const context = {};
		vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
		assert.equal(typeof context.initTagManager, 'function', 'Template initializer must be globally available');
	}
});