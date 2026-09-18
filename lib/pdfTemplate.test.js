'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPdfHtml } = require('./pdfTemplate');

test('buildPdfHtml wraps content in a full HTML document with the @page rule', () => {
  const html = buildPdfHtml('# Ada Lovelace');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('@page'));
  assert.ok(html.includes('size: letter'));
  assert.ok(html.includes('margin: 0.45in 0.6in'));
});

test('buildPdfHtml renders markdown headings and bold text', () => {
  const html = buildPdfHtml('# Ada Lovelace\n\n**Mathematician**');
  assert.ok(html.includes('<h1>Ada Lovelace</h1>'));
  assert.ok(html.includes('<strong>Mathematician</strong>'));
});

test('buildPdfHtml turns single newlines into <br> (breaks: true, matches print view)', () => {
  const html = buildPdfHtml('Line one\nLine two');
  assert.ok(html.includes('Line one<br>Line two'));
});

test('buildPdfHtml renders bullet lines as a real list', () => {
  const html = buildPdfHtml('- First\n- Second');
  assert.ok(html.includes('<li>First</li>'));
  assert.ok(html.includes('<li>Second</li>'));
});
