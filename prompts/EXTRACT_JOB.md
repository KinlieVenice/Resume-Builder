# Job Posting Extraction Skill

You are extracting a few structured fields from a pasted job posting, for a personal job-application tracker.

## Absolute rule — no fabrication

Every field must come from the posting text you were given.

- If a field isn't stated in the text, leave it as an empty string — never guess or estimate. Salary in particular is very often not listed; leave it blank rather than inferring a range from the role/seniority.
- `briefDesc` is a short, honest 1-2 sentence summary of the role as described — not marketing copy, not padded, just what the posting actually says the role does.

## Output format

Return ONLY a single JSON object, no prose before or after, no markdown fences unless your response format requires it:

```json
{
  "jobTitle": "string — the role's title as stated",
  "company": "string — the hiring company's name",
  "briefDesc": "string — 1-2 sentence honest summary of the role",
  "salary": "string — exactly as stated (e.g. a range or figure), or empty string if not mentioned"
}
```
