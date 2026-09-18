'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPdfBuffer } = require('./exportPdf');

function fakePuppeteer(pdfBytes) {
  const calls = { setContent: [], pdf: [], closed: false };
  return {
    calls,
    launch: async () => ({
      newPage: async () => ({
        setContent: async (html) => { calls.setContent.push(html); },
        pdf: async (options) => { calls.pdf.push(options); return pdfBytes; },
      }),
      close: async () => { calls.closed = true; },
    }),
  };
}

test('renderPdfBuffer sets the built HTML and requests preferCSSPageSize', async () => {
  const fake = fakePuppeteer(new Uint8Array([1, 2, 3]));
  await renderPdfBuffer('# Ada Lovelace', fake);
  assert.ok(fake.calls.setContent[0].includes('Ada Lovelace'));
  assert.equal(fake.calls.pdf[0].preferCSSPageSize, true);
  assert.ok(fake.calls.closed);
});

test('renderPdfBuffer wraps the Uint8Array result in a real Buffer', async () => {
  const fake = fakePuppeteer(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  const buf = await renderPdfBuffer('# Ada Lovelace', fake);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString(), '%PDF');
});

test('renderPdfBuffer closes the browser even if pdf() throws', async () => {
  const calls = { closed: false };
  const failing = {
    launch: async () => ({
      newPage: async () => ({
        setContent: async () => {},
        pdf: async () => { throw new Error('boom'); },
      }),
      close: async () => { calls.closed = true; },
    }),
  };
  await assert.rejects(() => renderPdfBuffer('# Ada Lovelace', failing), /boom/);
  assert.ok(calls.closed);
});

test('renderPdfBuffer with the real puppeteer produces a valid PDF buffer', async () => {
  const buf = await renderPdfBuffer('# Ada Lovelace\n\n## SUMMARY\nWorked on the Analytical Engine.');
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');
});
