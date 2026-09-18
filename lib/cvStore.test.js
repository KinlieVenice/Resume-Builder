'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./cvStore');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cvstore-test-'));
}

test('slugify lowercases and dashes non-alphanumerics', () => {
  assert.equal(slugify('Jhorizrodel Aquino'), 'jhorizrodel-aquino');
  assert.equal(slugify('  Weird!!  Name__2  '), 'weird-name-2');
});

test('writeCV then readCV round-trips data', () => {
  const dir = tmpDir();
  const cv = { name: 'Ada Lovelace', skills: ['math'] };
  writeCV(dir, 'ada-lovelace', cv);
  const readBack = readCV(dir, 'ada-lovelace');
  assert.deepEqual(readBack, cv);
});

test('readCV throws for missing person', () => {
  const dir = tmpDir();
  assert.throws(() => readCV(dir, 'nobody'), /No CV found/);
});

test('listPeople returns id+name for every stored CV', () => {
  const dir = tmpDir();
  writeCV(dir, 'ada-lovelace', { name: 'Ada Lovelace' });
  writeCV(dir, 'alan-turing', { name: 'Alan Turing' });
  const people = listPeople(dir).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(people, [
    { id: 'ada-lovelace', name: 'Ada Lovelace' },
    { id: 'alan-turing', name: 'Alan Turing' },
  ]);
});

test('deleteCV removes the file, readCV then throws', () => {
  const dir = tmpDir();
  writeCV(dir, 'ada-lovelace', { name: 'Ada Lovelace' });
  deleteCV(dir, 'ada-lovelace');
  assert.throws(() => readCV(dir, 'ada-lovelace'), /No CV found/);
});
