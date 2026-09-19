'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { writeCV } = require('../lib/cvStore');

const cvsDir = path.join(__dirname, '..', 'cvs');
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = openDb(path.join(dataDir, 'resume-tailor.db'));

if (!fs.existsSync(cvsDir)) {
  console.log('No cvs/ directory found — nothing to import.');
  process.exit(0);
}

const files = fs.readdirSync(cvsDir).filter((f) => f.endsWith('.json'));
for (const file of files) {
  const id = file.slice(0, -'.json'.length);
  const data = JSON.parse(fs.readFileSync(path.join(cvsDir, file), 'utf8'));
  writeCV(db, id, data);
  console.log(`Imported ${id} (${data.name})`);
}

console.log(`Done — imported ${files.length} CV(s) into data/resume-tailor.db.`);
