'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('./db');
const { slugify, listPeople, readCV, writeCV, deleteCV } = require('./cvStore');

function testDb() {
  return openDb(':memory:');
}

test('slugify lowercases and dashes non-alphanumerics', () => {
  assert.equal(slugify('Jhorizrodel Aquino'), 'jhorizrodel-aquino');
  assert.equal(slugify('  Weird!!  Name__2  '), 'weird-name-2');
});

test('writeCV then readCV round-trips data', () => {
  const db = testDb();
  const cv = { name: 'Ada Lovelace', skills: ['math'] };
  writeCV(db, 'ada-lovelace', cv);
  assert.deepEqual(readCV(db, 'ada-lovelace'), cv);
});

test('writeCV on an existing id overwrites rather than duplicating', () => {
  const db = testDb();
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace', skills: ['math'] });
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace', skills: ['math', 'logic'] });
  assert.deepEqual(readCV(db, 'ada-lovelace').skills, ['math', 'logic']);
  assert.equal(listPeople(db).length, 1);
});

test('readCV throws for missing person', () => {
  const db = testDb();
  assert.throws(() => readCV(db, 'nobody'), /No CV found/);
});

test('listPeople returns id+name for every stored CV, sorted by name', () => {
  const db = testDb();
  writeCV(db, 'alan-turing', { name: 'Alan Turing' });
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace' });
  assert.deepEqual(listPeople(db), [
    { id: 'ada-lovelace', name: 'Ada Lovelace' },
    { id: 'alan-turing', name: 'Alan Turing' },
  ]);
});

test('deleteCV removes the row, readCV then throws', () => {
  const db = testDb();
  writeCV(db, 'ada-lovelace', { name: 'Ada Lovelace' });
  deleteCV(db, 'ada-lovelace');
  assert.throws(() => readCV(db, 'ada-lovelace'), /No CV found/);
});
