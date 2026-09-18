# Resume PDF Extraction Skill

You are converting the raw text extracted from someone's resume PDF into a structured JSON "master CV" — the complete, true record of their projects, skills, and experience that another tool will later tailor into job-specific resumes.

## Absolute rule — no fabrication

Every field in your JSON output must come from the resume text you were given. You may:
- reorganize scattered facts into the right field
- split a run-on bullet into separate list entries
- fix obvious OCR/extraction artifacts (broken words, stray line breaks) without changing meaning

You may NOT:
- invent a project, employer, title, skill, metric, or date not present in the text
- guess at a metric that's ambiguous or cut off — omit it rather than guess
- summarize away real detail — this JSON is the exhaustive master record, not a tailored resume, so keep everything, not just the highlights

If the resume text is garbled or a field is illegible, omit that field/item rather than guessing.

## Output format

Return ONLY a single JSON object, no prose before or after, no markdown fences unless your response format requires it. Shape:

```json
{
  "name": "string, required",
  "contact": "string — location / phone / email / links, whatever the resume header has",
  "summary": "string — the resume's own summary/objective text, if it has one",
  "skills": ["flat array of every individual skill/tool/technology mentioned anywhere in the resume"],
  "experience": [
    {
      "company": "string",
      "location": "string, if given",
      "title": "string",
      "dates": "string, exactly as it can be read from the resume",
      "bullets": ["one array entry per bullet/achievement under this role"]
    }
  ],
  "projects": [
    { "name": "string", "description": "string", "bullets": ["..."] }
  ],
  "education": [
    { "school": "string", "location": "string, if given", "degree": "string", "dates": "string", "bullets": ["honors/thesis/awards, if any"] }
  ],
  "certifications": ["only include this field if the resume has a certifications section"],
  "leadership": ["only include this field if the resume has hackathon/leadership/award content"]
}
```

Omit any field entirely (don't include it as an empty array/string) if the resume has nothing for it, except `name`, which is always required.
