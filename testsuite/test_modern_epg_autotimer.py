from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
AUTOTIMERS = ROOT / 'sourcefiles/modern/js/autotimers.mjs'
TEMPLATES = (
    ROOT / 'plugin/controllers/views/responsive/ajax/event.tmpl',
    ROOT / 'plugin/controllers/views/responsive/ajax/epgdialog.tmpl',
)


class ModernEpgAutoTimerTests(unittest.TestCase):
    def test_epg_links_encode_event_details(self):
        for path in TEMPLATES:
            with self.subTest(template=path.name):
                template = path.read_text(encoding='utf-8')
                self.assertIn("quote($event.title, safe='')", template)
                self.assertIn("quote($event.sref, safe='')", template)
                self.assertIn('sname=$atSname', template)
                if path.name == 'event.tmpl':
                    self.assertIn('<button type="button" data-href="/#/at/new?name=$atName&amp;match=$atName', template)
                    self.assertIn('onclick="window.location.href=this.dataset.href"', template)
                else:
                    self.assertIn('href="/#/at/new?name=$atName&amp;match=$atName', template)
                    self.assertIn('onclick="window.location.href=this.href"', template)
                self.assertNotIn('location.href="#/at/new?', template)

    def test_epg_navigation_opens_prefilled_enabled_autotimer(self):
        script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[1], 'utf8');
const { AutoTimersApp } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const title = "M & O'Connor + Café #1";
const escapedTitle = title.replace('&', '&amp;').replace("'", '&#x27;');
const sref = '1:0:1:AB/CD?x=1&y=2';
const sname = 'News & More';
const params = new URLSearchParams({
  name: escapedTitle, match: escapedTitle, timespanFrom: '12:15', timespanTo: '13:30',
  sref, sname: 'News &amp; More',
});
const controls = new Map();
const selectedTags = [];
const addedTags = [];
const tagChoices = {
  setChoices: (choices, valueKey, labelKey) => {
    assert.equal(valueKey, 'value');
    assert.equal(labelKey, 'label');
    for (const choice of choices) {
      assert.equal(typeof choice.value, 'string');
      assert.equal(choice.label, choice.value);
      addedTags.push(choice.value);
    }
    return tagChoices;
  },
  removeActiveItems: () => {
    selectedTags.length = 0;
    return tagChoices;
  },
  setChoiceByValue: values => {
    selectedTags.push(...values);
    return tagChoices;
  },
};
const elements = {
  namedItem: name => {
    if (!controls.has(name)) {
      controls.set(name, {
        type: name === 'enabled' ? 'checkbox' : name === 'tag' ? 'select-multiple' : 'text',
        value: name === 'enabled' ? 'yes' : '',
        checked: false,
        dispatchEvent: () => {},
      });
    }
    return controls.get(name);
  },
};
globalThis.RadioNodeList = class {};
globalThis.document = {
  querySelector: () => ({ elements, reset: () => {} }),
  querySelectorAll: () => [],
  getElementById: () => ({ classList: { toggle: () => {} } }),
  createElement: () => ({
    set innerHTML(html) { this.value = html.replaceAll('&amp;', '&').replaceAll('&#x27;', "'"); },
  }),
};
globalThis.owif = {
  api: { getAllServices: async () => [], getTags: async () => [] },
  gui: { preparedChoices: () => ({ tag: tagChoices }) },
  utils: { debugLog: () => {}, isBouquet: () => false },
};
globalThis.window = { location: { hash: `#/at/new?${params}` }, scroll: () => {} };
const app = new AutoTimersApp();
let listShown = false;
app.prepareChoices = () => {};
app.populateFilters = () => {};
app.populateList = () => { listShown = true; };
app.initEventHandlers = () => {};
await app.init();
assert.equal(listShown, false);
assert.equal(controls.get('name').value, title);
assert.equal(controls.get('match').value, title);
assert.equal(controls.get('enabled').checked, true);
assert.equal(controls.get('searchType').value, 'exact');
assert.equal(controls.get('searchCase').value, 'sensitive');
assert.equal(controls.get('timespanFrom').value, '11:15');
assert.equal(controls.get('timespanTo').value, '14:30');
assert.deepEqual(controls.get('services').value, [{ sRef: sref, name: sname, selected: true }]);
assert.deepEqual(selectedTags, ['Autotimer']);
assert.equal(controls.has('sref'), false);
assert.equal(controls.has('sname'), false);

app.allTags = [{ value: 'Vorhanden', label: 'Vorhanden' }];
addedTags.length = 0;
await app.populateForm({ name: title, match: title, e2tag: ['Vorhanden', 'Zusatz'] });
assert.deepEqual(addedTags, ['Zusatz']);
assert.deepEqual(selectedTags, ['Vorhanden', 'Zusatz']);

let plainEntry;
app.populateForm = data => { plainEntry = data; };
window.location.hash = '#/at/new';
await app.init();
assert.equal(plainEntry.e2tag, undefined);

window.location.hash = '#/at';
await app.init();
assert.equal(listShown, true);

let editId;
app.editEntry = id => { editId = id; };
window.location.hash = '#/at/edit?id=23';
await app.init();
assert.equal(editId, '23');
'''
        result = subprocess.run(
            ['node', '--input-type=module', '-e', script, str(AUTOTIMERS)],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()