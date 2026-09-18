'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { parseInlineSegments, renderDocxBuffer } = require('./exportDocx');

test('parseInlineSegments returns plain text as a single segment', () => {
  assert.deepEqual(parseInlineSegments('plain text'), [{ text: 'plain text' }]);
});

test('parseInlineSegments marks a **bold** span', () => {
  assert.deepEqual(parseInlineSegments('**bold**'), [{ text: 'bold', bold: true }]);
});

test('parseInlineSegments marks an *italic* span', () => {
  assert.deepEqual(parseInlineSegments('*italic*'), [{ text: 'italic', italic: true }]);
});

test('parseInlineSegments splits a bold lead-in from trailing plain text', () => {
  assert.deepEqual(parseInlineSegments('**Company** (Manila)'), [
    { text: 'Company', bold: true },
    { text: ' (Manila)' },
  ]);
});

test('parseInlineSegments handles a fully italic line', () => {
  assert.deepEqual(parseInlineSegments('*Title · context*'), [
    { text: 'Title · context', italic: true },
  ]);
});

async function unzipDocumentXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

test('renderDocxBuffer produces a valid docx buffer', async () => {
  const buf = await renderDocxBuffer('# Ada Lovelace\nMathematician\n\n## SUMMARY\nWorked on the Analytical Engine.');
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 4).toString('hex'), '504b0304');
});

test('renderDocxBuffer centers the name and contact block', async () => {
  const buf = await renderDocxBuffer('# Ada Lovelace\nMathematician');
  const xml = await unzipDocumentXml(buf);
  assert.ok(xml.includes('Ada Lovelace'));
  assert.ok(xml.includes('Mathematician'));
  assert.match(xml, /<w:jc w:val="center"\/>/);
});

test('renderDocxBuffer gives section headings a bottom border', async () => {
  const buf = await renderDocxBuffer('# Ada Lovelace\n\n## SUMMARY\nBody text.');
  const xml = await unzipDocumentXml(buf);
  assert.ok(xml.includes('SUMMARY'));
  assert.match(xml, /<w:pBdr>/);
});

test('renderDocxBuffer renders bullet lines as real list items', async () => {
  const buf = await renderDocxBuffer('# Ada Lovelace\n\n## PROJECTS\n- First bullet point.\n- Second bullet point.');
  const xml = await unzipDocumentXml(buf);
  assert.ok(xml.includes('First bullet point.'));
  assert.ok(xml.includes('Second bullet point.'));
  assert.match(xml, /<w:numPr>/);
});
