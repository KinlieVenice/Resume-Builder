'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractTextFromPdf,
  buildExtractMessages,
  parseExtractResponse,
} = require('./extractCv');

test('extractTextFromPdf returns the text field from the injected parser', async () => {
  const fakePdfParse = async (buffer) => {
    assert.ok(Buffer.isBuffer(buffer));
    return { text: 'Ada Lovelace\nMathematician' };
  };
  const text = await extractTextFromPdf(Buffer.from('fake pdf bytes'), fakePdfParse);
  assert.equal(text, 'Ada Lovelace\nMathematician');
});

test('buildExtractMessages puts skill text as system message and resume text in user message', () => {
  const messages = buildExtractMessages({
    skillText: 'EXTRACT RULES',
    resumeText: 'Ada Lovelace, Mathematician',
  });
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'EXTRACT RULES');
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('Ada Lovelace, Mathematician'));
});

test('parseExtractResponse parses plain JSON', () => {
  const cv = parseExtractResponse('{"name": "Ada Lovelace", "skills": ["math"]}');
  assert.deepEqual(cv, { name: 'Ada Lovelace', skills: ['math'] });
});

test('parseExtractResponse strips a ```json code fence', () => {
  const text = '```json\n{"name": "Ada Lovelace"}\n```';
  const cv = parseExtractResponse(text);
  assert.deepEqual(cv, { name: 'Ada Lovelace' });
});

test('parseExtractResponse strips a plain ``` code fence', () => {
  const text = '```\n{"name": "Ada Lovelace"}\n```';
  const cv = parseExtractResponse(text);
  assert.deepEqual(cv, { name: 'Ada Lovelace' });
});

test('parseExtractResponse throws a clear error on invalid JSON', () => {
  assert.throws(() => parseExtractResponse('not json at all'), /not valid JSON/);
});

test('parseExtractResponse throws when the JSON has no name field', () => {
  assert.throws(() => parseExtractResponse('{"skills": ["math"]}'), /missing "name"/);
});
