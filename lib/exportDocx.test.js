'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResumeHtml, renderDocxBuffer } = require('./exportDocx');

test('buildResumeHtml renders markdown headings and bold text', () => {
  const html = buildResumeHtml('# Ada Lovelace\n\n**Mathematician**');
  assert.ok(html.includes('<h1>Ada Lovelace</h1>'));
  assert.ok(html.includes('<strong>Mathematician</strong>'));
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
