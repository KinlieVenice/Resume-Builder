'use strict';

function buildTailorMessages({ skillText, cv, jobDescription }) {
  return [
    { role: 'system', content: skillText },
    {
      role: 'user',
      content: [
        'MASTER CV (JSON):',
        JSON.stringify(cv, null, 2),
        '',
        'JOB DESCRIPTION:',
        jobDescription,
      ].join('\n'),
    },
  ];
}

function parseTailorResponse(text) {
  const RESUME_MARKER = '## RESUME';
  const MATCH_MARKER = '## MATCH_REPORT';
  const resumeIdx = text.indexOf(RESUME_MARKER);
  const matchIdx = text.indexOf(MATCH_MARKER);

  if (resumeIdx === -1 || matchIdx === -1 || matchIdx < resumeIdx) {
    throw new Error('Model response missing ## RESUME / ## MATCH_REPORT sections');
  }

  const resume = text.slice(resumeIdx + RESUME_MARKER.length, matchIdx).trim();
  const matchReport = text.slice(matchIdx + MATCH_MARKER.length).trim();

  const matched = (matchReport.match(/^- ✅/gm) || []).length;
  const unmatched = (matchReport.match(/^- ❌/gm) || []).length;
  const total = matched + unmatched;
  const matchPercent = total === 0 ? 0 : Math.round((matched / total) * 100);

  return { resume, matchReport, matchPercent, matched, unmatched };
}

module.exports = { buildTailorMessages, parseTailorResponse };
