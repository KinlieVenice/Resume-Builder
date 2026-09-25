'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

test('profile save clears new and edited profiles only after a successful response', async () => {
  const source = readFileSync('public/app.js', 'utf8');
  const handler = source.slice(source.indexOf("el('save-cv-btn').addEventListener"), source.indexOf("el('delete-cv-btn').addEventListener"));
  for (const id of [null, 'ada']) {
    for (const ok of [true, false]) {
      let save;
      const alerts = [];
      const json = '{"name":"Ada"}';
      const elements = {
        'save-cv-btn': { addEventListener: (_, callback) => { save = callback; } },
        'cv-json': { value: json }, 'cv-error': {}, 'cv-editor-title': { textContent: 'Ada' },
      };
      const state = { selectedPersonId: id };
      const context = vm.createContext({
        showAlert: async options => alerts.push(options.titleText),
        el: key => elements[key], state, withLoading: (_, action) => action,
        fetch: async (url, options) => {
          assert.equal(url, id ? '/api/cv/ada' : '/api/people');
          assert.equal(options.method, id ? 'PUT' : 'POST');
          return { ok, json: async () => ({ error: 'Save failed' }) };
        },
        renderPeopleList() {}, loadPeople: async () => {},
      });
      vm.runInContext(handler, context);
      if (ok) {
        await save();
        assert.deepEqual(alerts, ['Successfully saved']);
        assert.equal(elements['cv-json'].value, '');
        assert.equal(state.selectedPersonId, null);
        assert.equal(elements['cv-editor-title'].textContent, 'New person');
      } else {
        await assert.rejects(save(), /Save failed/);
        assert.deepEqual(alerts, []);
        assert.equal(elements['cv-json'].value, json);
        assert.equal(state.selectedPersonId, id);
      }
    }
  }
});
