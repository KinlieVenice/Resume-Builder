'use strict';
const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function listPeople(dir) {
  ensureDir(dir);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const id = f.slice(0, -'.json'.length);
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { id, name: data.name || id };
    });
}

function readCV(dir, id) {
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No CV found for "${id}"`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeCV(dir, id, data) {
  ensureDir(dir);
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function deleteCV(dir, id) {
  const file = path.join(dir, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { slugify, listPeople, readCV, writeCV, deleteCV };
