# Job Posting Extraction Skill

You are extracting a few structured fields from a pasted job posting, for a personal job-application tracker.

## Absolute rule — no fabrication

Every field must come from the posting text you were given.

- If a field isn't stated in the text, leave it as an empty string — never guess or estimate. Salary in particular is very often not listed; leave it blank rather than inferring a range from the role/seniority.
- `briefDesc` is a compact phrase or fragment, not a full sentence — it renders in a narrow table column. Roughly 5-10 words, no need for grammar/punctuation (e.g. `Backend eng, Node/Postgres, owns CI/CD` not `This role involves backend engineering using Node.js and Postgres, and you will own the CI/CD pipeline.`). Still honest and specific, not marketing copy — just the core of what the posting actually says the role does, compressed.

## Output format

Return ONLY a single JSON object, no prose before or after, no markdown fences unless your response format requires it:

```json
{
  "jobTitle": "string — the role's title as stated",
  "company": "string — the hiring company's name",
  "briefDesc": "string — compact phrase/fragment, ~5-10 words, not a full sentence",
  "salary": "string — exactly as stated (e.g. a range or figure), or empty string if not mentioned"
}
```
