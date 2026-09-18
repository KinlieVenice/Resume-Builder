'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTailorMessages, parseTailorResponse } = require('./promptBuilder');

test('buildTailorMessages puts skill text as system message', () => {
  const messages = buildTailorMessages({
    skillText: 'RULES GO HERE',
    cv: { name: 'Ada' },
    jobDescription: 'Looking for a backend engineer',
  });
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'RULES GO HERE');
});

test('buildTailorMessages user message includes CV JSON and job description', () => {
  const messages = buildTailorMessages({
    skillText: 'RULES',
    cv: { name: 'Ada', skills: ['C++'] },
    jobDescription: 'Looking for a backend engineer',
  });
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('"name": "Ada"'));
  assert.ok(messages[1].content.includes('"C++"'));
  assert.ok(messages[1].content.includes('Looking for a backend engineer'));
});

test('parseTailorResponse splits resume and match report, computes percent', () => {
  const text = [
    '## RESUME',
    '# Ada Lovelace',
    'Summary here.',
    '',
    '## MATCH_REPORT',
    '- ✅ Python — master CV lists 5 years Python',
    '- ✅ SQL — master CV lists Postgres experience',
    '- ❌ Kubernetes — not found in master CV',
  ].join('\n');

  const result = parseTailorResponse(text);
  assert.ok(result.resume.includes('# Ada Lovelace'));
  assert.ok(!result.resume.includes('MATCH_REPORT'));
  assert.ok(result.matchReport.includes('Kubernetes'));
  assert.equal(result.matched, 2);
  assert.equal(result.unmatched, 1);
  assert.equal(result.matchPercent, 67);
});

test('parseTailorResponse returns 0 percent when no checklist lines found', () => {
  const text = '## RESUME\nHello\n\n## MATCH_REPORT\n(no requirements identified)';
  const result = parseTailorResponse(text);
  assert.equal(result.matchPercent, 0);
});

test('parseTailorResponse throws when markers are missing', () => {
  assert.throws(
    () => parseTailorResponse('just some text with no markers'),
    /missing ## RESUME/,
  );
});
