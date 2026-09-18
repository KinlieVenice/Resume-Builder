'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResumeHtml, renderDocxBuffer } = require('./exportDocx');

test('buildResumeHtml renders the name centered and bold, no raw <h1>', () => {
  const html = buildResumeHtml('# Ada Lovelace\n\nNaic, Cavite');
  assert.ok(!html.includes('<h1>'));
  assert.ok(html.includes('text-align:center'));
  assert.ok(html.includes('<strong>Ada Lovelace</strong>'));
});

test('buildResumeHtml centers only the one paragraph right after the name', () => {
  const html = buildResumeHtml('# Ada Lovelace\nNaic, Cavite\n\n## SUMMARY\nWorked on the Analytical Engine.');
  const contactP = '<p style="text-align:center;font-size:9pt;">Naic, Cavite</p>';
  assert.ok(html.includes(contactP));
  assert.ok(html.includes('<p>Worked on the Analytical Engine.</p>'));
});

test('buildResumeHtml renders section headings bold, uppercase, no raw <h2>', () => {
  const html = buildResumeHtml('# Ada\n\n## Summary');
  assert.ok(!html.includes('<h2>'));
  assert.ok(html.includes('<strong>SUMMARY</strong>'));
});

test('buildResumeHtml turns single newlines into <br> (breaks: true)', () => {
  const html = buildResumeHtml('Line one\nLine two');
  assert.ok(html.includes('Line one<br>Line two'));
});

test('renderDocxBuffer passes the html through to the injected implementation', async () => {
  const calls = [];
  const fakeHtmlToDocx = async (html, header, options) => {
    calls.push({ html, header, options });
    return Buffer.from('fake docx bytes');
  };
  const buf = await renderDocxBuffer('<h1>Ada</h1>', fakeHtmlToDocx);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString(), 'fake docx bytes');
  assert.equal(calls[0].html, '<h1>Ada</h1>');
});

test('renderDocxBuffer with the real html-to-docx produces a valid docx buffer', async () => {
  const buf = await renderDocxBuffer('<h1>Ada Lovelace</h1><p>Mathematician</p>');
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 4).toString('hex'), '504b0304');
});
