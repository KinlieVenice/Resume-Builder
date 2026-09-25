'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

test('loader blocks through overlapping work and releases after success or failure', async () => {
  const elements = {
    'loading-dialog': { open: false, showModal() { this.open = true; }, close() { this.open = false; } },
    'loading-message': {}, 'operation-error': {},
  };
  const classes = new Set();
  const context = vm.createContext({
    el: id => elements[id],
    document: { body: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } } },
  });
  const source = readFileSync('public/app.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('let pendingOperations'), source.indexOf("el('loading-dialog').addEventListener")), context);
  let finish;
  const running = context.withLoading('Extracting…', () => new Promise(resolve => { finish = resolve; }))();
  assert.equal(elements['loading-dialog'].open, true);
  assert.equal(elements['loading-message'].textContent, 'Extracting…');
  await context.withLoading('Loading…', async () => {})();
  assert.equal(elements['loading-dialog'].open, true);
  finish();
  await running;
  assert.equal(elements['loading-dialog'].open, false);
  await context.withLoading('Saving…', async () => { throw new Error('Network unavailable'); })();
  assert.equal(elements['loading-dialog'].open, false);
  assert.equal(classes.size, 0);
  assert.equal(elements['operation-error'].textContent, 'Network unavailable');
});

test('SweetAlert suspends the native loader and restores it after dismissal or failure', async () => {
  const source = readFileSync('public/app.js', 'utf8');
  for (const fails of [false, true]) {
    const dialog = { open: true, close() { this.open = false; }, showModal() { this.open = true; } };
    const context = vm.createContext({
      el: () => dialog, pendingOperations: 1,
      Swal: { fire: async options => {
        assert.equal(dialog.open, false, 'loader must not cover the confirmation');
        assert.equal(options.showCancelButton, true);
        if (fails) throw new Error('Popup failed');
        return { isConfirmed: false };
      } },
    });
    vm.runInContext(source.slice(source.indexOf('async function showAlert'), source.indexOf('function showTab')), context);
    const result = context.showAlert({ showCancelButton: true });
    if (fails) await assert.rejects(result, /Popup failed/);
    else assert.equal((await result).isConfirmed, false);
    assert.equal(dialog.open, true);
  }
});
