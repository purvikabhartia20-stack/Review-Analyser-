# Groww Review Analyser — Evaluation & Testing Guide

> **For agents reading this:** Before marking any phase complete, run every check in that phase's section. A phase is only done when ALL assertions pass and ALL edge cases are handled. If a check fails, fix the code — do not skip the check or mark it as acceptable.

---

## How to Use This Document

Each phase has three layers of checks:

| Layer | What it is |
|---|---|
| **Unit checks** | Assertions you can run in isolation with mock data |
| **Integration checks** | Assertions that require real network/API calls |
| **Edge cases** | Specific inputs known to cause bugs or hallucinations |

Run unit checks first (fast, no API cost). Run integration checks after unit checks pass. Edge cases are embedded in both.

---

## Global Rules (apply to every phase)

Before running any phase-specific check, verify these hold across the entire pipeline:

```
[ ] No review object ever contains: userName, userImage, url, replyText, replyDate
[ ] No output file or log line contains an email address pattern (\S+@\S+\.\S+)
[ ] No output file or log line contains a 10-digit phone number (\b\d{10}\b)
[ ] The word "undefined" never appears in pulse_text
[ ] The word "null" never appears in pulse_text
[ ] No phase throws an unhandled promise rejection — all async errors are caught
```

---

## Phase 1 — Ingest Reviews

### Unit checks (run with mock data, no network)

**Check 1.1 — PII stripping**
```js
// Input: a raw scraper object with PII fields
const raw = {
  id: 'r1', score: 3, title: 'ok app', text: 'works fine',
  date: new Date('2025-04-01'),
  userName: 'john_doe',       // must be stripped
  userImage: 'https://...',   // must be stripped
  url: 'https://play.google.com/...'  // must be stripped
}
// After mapReview(raw):
assert(!('userName'  in result))
assert(!('userImage' in result))
assert(!('url'       in result))
assert(result.store === 'play_store')
assert(result.theme === null)
```

**Check 1.2 — ID fallback**
```js
// Input: raw object with no id field
const raw = { score: 4, text: 'good app', date: new Date('2025-04-01') }
const result = mapReview(raw)
assert(typeof result.id === 'string')
assert(result.id.length === 12)   // sha1 slice
```

**Check 1.3 — Date normalisation**
```js
// Input: date as a Date object
const raw = { id: 'r1', score: 4, text: 'good', date: new Date('2025-04-15T10:30:00Z') }
assert(mapReview(raw).date === '2025-04-15')

// Input: date as an ISO string
const raw2 = { id: 'r2', score: 4, text: 'good', date: '2025-04-15T10:30:00Z' }
assert(mapReview(raw2).date === '2025-04-15')
```

**Check 1.4 — Deduplication**
```js
// Input: two reviews with the same id
const reviews = [
  { id: 'dup', score: 4, text: 'first', date: new Date() },
  { id: 'dup', score: 3, text: 'second', date: new Date() }
]
const result = ingestReviews(reviews)  // pass mock data
assert(result.length === 1)
assert(result[0].text === 'first')   // first occurrence kept
```

**Check 1.5 — Hard cap at 150**
```js
// Input: 200 reviews
const manyReviews = Array.from({ length: 200 }, (_, i) => ({
  id: `r${i}`, score: 4, text: `review ${i}`, date: new Date()
}))
const result = processReviews(manyReviews)
assert(result.length <= 150)
```

### Integration checks (requires network)

**Check 1.6 — Real fetch returns data**
```
Run: node -e "import('./src/phase1_ingest.js').then(m => m.ingestReviews()).then(r => { console.log('count:', r.length); console.log('sample:', JSON.stringify(r[0], null, 2)) })"

Assert:
- count is between 1 and 150
- sample object has: id, store, rating, title, text, date, theme
- sample object does NOT have: userName, userImage, url
- store === "play_store"
- date matches YYYY-MM-DD format
```

**Check 1.7 — Rating is a number**
```
For every review in the result:
  assert(review.rating === null || (Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5))
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| `review.text` is `undefined` | Map to `''` — do not throw |
| `review.title` is `undefined` | Map to `null` — do not throw |
| `review.score` is `0` | Map to `null` (0 is not a valid Play Store rating) |
| `review.date` is `null` | Use today's date as fallback — do not throw |
| Network returns 0 reviews | Throw with message: "No reviews found — check app ID and network connection." |
| Network returns 5 reviews | Log warning "Sample is small" but return the 5 reviews — do not throw |
| Scraper returns `result.data` array | Handle both `result.data` and `result` shapes |

---

## Phase 2 — Clean and Filter

### Unit checks

**Check 2.1 — Emoji stripping**
```js
const inputs = [
  'great app 😍🔥',           // common emojis
  'kyc is broken 💔',
  '⭐⭐⭐ good enough',
  'works fine 🙏🏽',           // skin tone modifier
  'no emoji here at all'
]
// After stripEmojis():
assert(stripEmojis('great app 😍🔥') === 'great app')
assert(stripEmojis('⭐⭐⭐ good enough') === 'good enough')
assert(stripEmojis('no emoji here at all') === 'no emoji here at all')
// No emoji character remains — test with: /\p{Emoji}/u.test(result) === false
```

**Check 2.2 — English filter keeps English, drops others**
```js
assert(isEnglish('the app keeps crashing on my phone') === true)
assert(isEnglish('bahut achha app hai lekin kyc nahi ho raha') === false)  // Hindi
assert(isEnglish('यह ऐप बहुत अच्छा है') === false)                         // Hindi script
assert(isEnglish('muito bom aplicativo') === false)                         // Portuguese
assert(isEnglish('ok') === true)   // too short → 'und' → keep (< 20 chars)
assert(isEnglish('好的') === false)  // Chinese — no English stop words
```

**Check 2.3 — Word count filter**
```js
// Exactly 6 words — must be dropped
assert(cleanReviews([makeReview('this app is very bad')]).length === 0)
// Exactly 7 words — must be kept
assert(cleanReviews([makeReview('this app is very very bad indeed')]).length === 1)
// 1 word — must be dropped
assert(cleanReviews([makeReview('bad')]).length === 0)
```

**Check 2.4 — Deduplication on normalised text**
```js
const reviews = [
  makeReview('The App Is Great'),   // will normalise to 'the app is great'
  makeReview('the app is great'),   // exact duplicate after normalise
  makeReview('the app is great '),  // trailing space duplicate
]
const result = cleanReviews(reviews)
assert(result.length === 1)
```

**Check 2.5 — Truncation at word boundary**
```js
// 310-character text — must be truncated to ≤300 chars ending with '…'
const longText = 'word '.repeat(62)  // 310 chars
const result = truncateAtWord(longText, 300)
assert(result.length <= 301)   // 300 chars + '…'
assert(result.endsWith('…'))
assert(!result.includes('word '.repeat(62)))  // was truncated
// Must not cut mid-word
assert(!result.slice(-4, -1).includes(' ') || result.endsWith('…'))
```

**Check 2.6 — Rating sanity**
```js
assert(sanitiseRating(3) === 3)
assert(sanitiseRating(0) === null)
assert(sanitiseRating(6) === null)
assert(sanitiseRating('4') === null)   // string — not integer
assert(sanitiseRating(null) === null)
assert(sanitiseRating(undefined) === null)
```

**Check 2.7 — Filter order: emoji strip before language detection**
```js
// A review that is only emojis — after stripping it becomes empty → fails word count
const emojiOnly = makeReview('😍🔥💔⭐🙏')
const result = cleanReviews([emojiOnly])
assert(result.length === 0)   // stripped to '' → 0 words → dropped
```

**Check 2.8 — Output schema integrity**
```js
// Every surviving review must still conform to the Data Contract
for (const r of cleanReviews(sampleReviews)) {
  assert(typeof r.id === 'string')
  assert(r.store === 'play_store')
  assert(r.theme === null)
  assert(typeof r.text === 'string')
  assert(r.text.length >= 1)
  assert(r.text.length <= 301)   // 300 + '…'
  assert(r.text === r.text.toLowerCase())   // normalised
  assert(!/\p{Emoji}/u.test(r.text))        // no emojis
}
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| Review text is only emojis | Stripped to empty string → fails word count → dropped |
| Review text is only spaces/newlines | Normalised to empty → fails word count → dropped |
| Review with mixed Hindi + English | `franc` may return `'hin'` → dropped. Acceptable — mixed reviews are noisy |
| Review text is exactly 300 chars | Not truncated — no `…` appended |
| Review text is exactly 301 chars | Truncated — `…` appended |
| All reviews are non-English | Throw: "All reviews were filtered out" |
| `franc-min` not installed | Fall back to stop-word heuristic — log warning, do not crash |
| Review title is `null` | `stripEmojis(null)` must return `null`, not throw |
| Duplicate detection: same text, different ratings | Keep first occurrence — rating of second is discarded |

---

## Phase 3A — Theme Clustering (Groq LLM)

### Unit checks (mock the Groq response)

**Check 3A.1 — Valid JSON response is parsed correctly**
```js
const mockResponse = JSON.stringify([
  { theme: 'KYC Verification', review_ids: ['r1', 'r2', 'r3'] },
  { theme: 'Payment Failures', review_ids: ['r4', 'r5'] }
])
// After parsing:
assert(themes.length === 2)
assert(themes[0].theme === 'KYC Verification')
assert(themes[0].review_ids.includes('r1'))
```

**Check 3A.2 — Markdown fence stripping**
```js
// Groq sometimes wraps JSON in ```json ... ```
const fenced = '```json\n[{"theme":"KYC","review_ids":["r1"]}]\n```'
const stripped = fenced.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
assert(JSON.parse(stripped)[0].theme === 'KYC')

// Also handle ``` without language tag
const fenced2 = '```\n[{"theme":"KYC","review_ids":["r1"]}]\n```'
// Same stripping logic must handle this
```

**Check 3A.3 — Theme count validation**
```js
// > 5 themes returned → take first 5 only
const tooMany = Array.from({ length: 7 }, (_, i) => ({ theme: `T${i}`, review_ids: [`r${i}`] }))
const result = enforceThemeLimit(tooMany)
assert(result.length === 5)

// < 2 themes returned → must throw after retry
const tooFew = [{ theme: 'Only One', review_ids: ['r1'] }]
// Expect: Error('[Phase 3A] LLM returned fewer than 2 themes.')
```

**Check 3A.4 — Every review gets a theme**
```js
const reviews = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]
const themes  = [{ theme: 'A', review_ids: ['r1', 'r2'] }]  // r3 missing
// After writing themes back:
// r3 must get theme 'Other' (fallback), not undefined or null
const themed = applyThemes(reviews, themes)
assert(themed.find(r => r.id === 'r3').theme === 'Other')
assert(!themed.some(r => r.theme === undefined))
assert(!themed.some(r => r.theme === null))
```

**Check 3A.5 — LLM input is text-only**
```js
// The array sent to Groq must only contain { id, text }
// It must NOT contain: rating, date, store, title, theme
const input = buildLLMInput(cleanReviews)
for (const item of input) {
  assert(Object.keys(item).sort().join(',') === 'id,text')
}
```

### Integration checks (real Groq API call)

**Check 3A.6 — Real clustering produces valid output**
```
Run with 20 real clean reviews.
Assert:
- Response is valid JSON (no parse error)
- Between 2 and 5 themes returned
- Every review ID from input appears in exactly one theme
- No theme has 0 review_ids
- Theme names are 1–3 words (no sentences)
```

**Check 3A.7 — Groq rate limit handling**
```
If HTTP 429 is returned:
- Error message must include "429"
- Pipeline must not silently continue with empty themes
- Suggest: add 3-second delay between Phase 3A and 3D calls
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| Groq returns plain text instead of JSON | Strip fences, retry once with JSON-only instruction |
| Groq returns JSON with extra fields (`"description"`, `"count"`) | Parse only `theme` and `review_ids` — ignore extra fields |
| Groq invents a review ID not in the input | That ID is silently ignored — only known IDs are mapped |
| All reviews assigned to one theme | Only 1 theme → retry; if still 1 → throw |
| Groq returns theme name with 10+ words | Accept it — theme name length is not validated (only count 2–5 matters) |
| `GROQ_API_KEY` is missing from `.env` | Throw immediately with: "GROQ_API_KEY is not set" — do not make the API call |
| Groq returns HTTP 401 | Throw: "Groq auth failed — check GROQ_API_KEY" |
| Groq returns HTTP 503 | Retry once after 3 seconds; if still 503, throw |
| Review IDs contain special characters | IDs are treated as opaque strings — no parsing needed |

---

## Phase 3B — Ranking (Pure Computation)

### Unit checks

**Check 3B.1 — Sorted by review count descending**
```js
const groups = [
  { theme: 'A', reviews: Array(10).fill({}) },
  { theme: 'B', reviews: Array(30).fill({}) },
  { theme: 'C', reviews: Array(20).fill({}) },
]
const top3 = rankThemes(groups)
assert(top3[0].theme === 'B')   // 30 reviews
assert(top3[1].theme === 'C')   // 20 reviews
assert(top3[2].theme === 'A')   // 10 reviews
```

**Check 3B.2 — avg_rating computed correctly**
```js
const group = { theme: 'X', reviews: [
  { rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: null }
]}
const result = computeStats(group)
assert(result.avg_rating === 2.0)   // (1+2+3)/3 = 2.0, null excluded
```

**Check 3B.3 — low_rating_pct computed correctly**
```js
const group = { theme: 'X', reviews: [
  { rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: 4 }, { rating: 5 }
]}
const result = computeStats(group)
assert(result.low_rating_pct === 40)   // 2 out of 5 are ≤2 → 40%
```

**Check 3B.4 — All ratings null**
```js
const group = { theme: 'X', reviews: [{ rating: null }, { rating: null }] }
const result = computeStats(group)
assert(result.avg_rating === null)
assert(result.low_rating_pct === null)
// pulse_text must show 'N/A' not 'null' for these fields
```

**Check 3B.5 — Fewer than 3 theme groups**
```js
// If only 2 themes exist after clustering, top3 should have 2 entries, not crash
const groups = [
  { theme: 'A', reviews: Array(10).fill({}) },
  { theme: 'B', reviews: Array(5).fill({}) },
]
const top = rankThemes(groups)
assert(top.length === 2)   // not 3 — do not pad with empty themes
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| Two themes have equal review count | Either order is acceptable — no crash |
| Theme has 1 review with rating 1 | `avg_rating = 1.0`, `low_rating_pct = 100` |
| Theme has 100 reviews all rating 5 | `low_rating_pct = 0` |
| `avg_rating` rounds to 1 decimal | `2.666...` → `2.7`, not `2.666666` |

---

## Phase 3C — Quote Selection (Pure Logic)

### Unit checks

**Check 3C.1 — Prefers low-rated reviews**
```js
const theme = {
  theme: 'KYC',
  reviews: [
    { rating: 5, text: 'great app works perfectly fine for me' },
    { rating: 1, text: 'kyc stuck for three days no response at all' },
    { rating: 3, text: 'average experience with the kyc process' }
  ]
}
const quote = selectQuote(theme)
assert(quote.text === 'kyc stuck for three days no response at all')
```

**Check 3C.2 — PII is rejected**
```js
const theme = {
  theme: 'Support',
  reviews: [
    { rating: 1, text: 'contact me at john@example.com for refund please' },  // email PII
    { rating: 2, text: 'call me at 9876543210 to resolve this issue' },        // phone PII
    { rating: 2, text: 'support team never responds to my complaints at all' } // clean
  ]
}
const quote = selectQuote(theme)
assert(quote.text === 'support team never responds to my complaints at all')
assert(!quote.text.includes('@'))
assert(!/\d{10}/.test(quote.text))
```

**Check 3C.3 — Truncation at 150 chars**
```js
const longText = 'a'.repeat(200)
const result = truncateQuote(longText)
assert(result.length === 151)   // 150 + '…'
assert(result.endsWith('…'))
```

**Check 3C.4 — Fallback when no low-rated review exists**
```js
const theme = {
  theme: 'Positive',
  reviews: [
    { rating: 4, text: 'good app but could be better overall' },
    { rating: 5, text: 'excellent app love it very much indeed' }
  ]
}
// Should not throw — pick shortest non-PII text
const quote = selectQuote(theme)
assert(typeof quote.text === 'string')
assert(quote.text.length > 0)
```

**Check 3C.5 — Output has exactly 3 quotes**
```js
const result = selectQuotes(top3Themes)
assert(result.length === 3)
assert(result.every(q => typeof q.theme === 'string'))
assert(result.every(q => typeof q.text === 'string'))
assert(result.every(q => q.text.length <= 151))
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| All reviews in a theme contain PII | Pick the last candidate anyway — PII check is best-effort |
| Theme has only 1 review | That review is the quote — no crash |
| Quote text is exactly 150 chars | No truncation, no `…` |
| Quote text is exactly 151 chars | Truncated to 150 + `…` |
| All reviews in theme have `rating: null` | Fall back to shortest text — no crash |

---

## Phase 3D — Action Ideas (Groq LLM)

### Unit checks (mock Groq response)

**Check 3D.1 — Numbered list is parsed correctly**
```js
const mockResponse = `1. Add a real-time KYC status tracker in the app dashboard.
2. Implement automatic payment reconciliation to fix failed transaction records.
3. Fix the mutual funds tab crash by profiling memory usage on low-end devices.`

const ideas = parseActionIdeas(mockResponse)
assert(ideas.length === 3)
assert(!ideas[0].startsWith('1.'))   // numbering stripped
assert(ideas[0].includes('KYC'))
```

**Check 3D.2 — Fewer than 3 ideas → padded**
```js
const mockResponse = '1. Fix KYC flow immediately.'
const ideas = parseActionIdeas(mockResponse, topThemes)
assert(ideas.length === 3)
// ideas[1] and ideas[2] are padding strings
assert(ideas[1].startsWith('Investigate'))
```

**Check 3D.3 — LLM input is compact (no full review texts)**
```js
const input = buildActionIdeasInput(topThemes, quotes)
// Must NOT contain any review text from the original reviews
// Must only contain theme summary lines and quote lines
assert(!input.includes(cleanReviews[0].text))
assert(input.includes(topThemes[0].theme))
assert(input.includes(quotes[0].text))
```

**Check 3D.4 — Ideas are ≤ 25 words each**
```js
for (const idea of actionIdeas) {
  const wordCount = idea.trim().split(/\s+/).length
  assert(wordCount <= 25, `Action idea too long: "${idea}" (${wordCount} words)`)
}
```

### Integration checks

**Check 3D.5 — Real Groq call produces 3 ideas**
```
Run with real topThemes and quotes.
Assert:
- Response contains exactly 3 numbered items
- Each item is a single sentence
- No item mentions a username, email, or phone number
- No item is generic (e.g. "Improve the app" alone is too vague — must reference a theme)
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| Groq returns 4 ideas | Take only first 3 |
| Groq returns ideas as a bullet list (`- `) instead of numbered | Parser must handle `- ` prefix too |
| Groq returns ideas with no numbering at all | Split on newlines, take first 3 non-empty lines |
| Groq returns a single paragraph instead of a list | Retry once; if still not a list, split on `. ` and take first 3 sentences |
| Action idea contains `null` or `undefined` literally | Replace with padding string |
| Groq returns ideas referencing a theme not in top_themes | Accept — do not validate theme names in ideas |

---

## Phase 3E — Pulse Assembly (Pure String Building)

### Unit checks

**Check 3E.1 — All placeholders are filled**
```js
const pulse = assemblePulse(cleanReviews, topThemes, quotes, actionIdeas)
assert(!pulse.includes('<'))          // no unfilled <placeholder>
assert(!pulse.includes('>'))          // no unfilled <placeholder>
assert(!pulse.includes('undefined'))
assert(!pulse.includes('null'))
assert(!pulse.includes('N/A★'))       // N/A should not have ★ appended
```

**Check 3E.2 — Word count ≤ 250**
```js
const words = pulse
  .split('\n')
  .filter(l => !l.startsWith('━'))   // exclude separator lines
  .join(' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean)
assert(words.length <= 250, `Pulse is ${words.length} words — exceeds 250`)
```

**Check 3E.3 — Week label is a Monday**
```js
const label = getWeekLabel()   // e.g. "12 May 2025"
const date  = new Date(label)
assert(date.getDay() === 1, 'Week label must be a Monday (getDay() === 1)')
```

**Check 3E.4 — Required sections present**
```js
assert(pulse.includes('TOP THEMES THIS WEEK'))
assert(pulse.includes('WHAT USERS ARE SAYING'))
assert(pulse.includes('ACTION IDEAS'))
assert(pulse.includes('GROWW APP — WEEKLY REVIEW PULSE'))
assert(pulse.includes('Generated by Groww Review Analyser'))
```

**Check 3E.5 — Quotes are wrapped in double quotes**
```js
for (const q of quotes) {
  assert(pulse.includes(`"${q.text}"`), `Quote not found in pulse: ${q.text}`)
}
```

**Check 3E.6 — Theme stats appear correctly**
```js
// If avg_rating is null, pulse must show 'N/A' not 'null★' or 'undefined★'
const themeWithNullRating = { theme: 'X', review_count: 5, avg_rating: null, low_rating_pct: null }
const line = formatThemeLine(themeWithNullRating)
assert(line.includes('N/A'))
assert(!line.includes('null'))
assert(!line.includes('undefined'))
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| Only 2 top themes (not 3) | Pulse shows 2 theme lines — no crash, no empty line |
| Action idea is 26 words | Truncate to 20 words and append `…` |
| `week_label` computed on a Sunday | Monday is the previous day — verify `getDay()` logic |
| `cleanReviews.length` is 0 | Should not reach 3E — Phase 2 would have thrown |
| Pulse exceeds 250 words | Truncate each action idea to 20 words and recount |

---

## Phase 4A — Google Drive MCP (create_file)

### Pre-call checks

**Check 4A.1 — Payload is well-formed before calling MCP**
```js
const payload = buildDrivePayload(pulseText, weekLabel)
assert(payload.mcpServer === 'drive')
assert(payload.tool === 'create_file')
assert(payload.params.name.startsWith('Groww Weekly Review Pulse'))
assert(payload.params.mimeType === 'application/vnd.google-apps.document')
assert(typeof payload.params.content === 'string')
assert(payload.params.content.length > 0)
assert(!payload.params.content.includes('undefined'))
assert(!payload.params.content.includes('null'))
```

**Check 4A.2 — Week label appears in document name**
```js
assert(payload.params.name.includes(weekLabel))
// e.g. "Groww Weekly Review Pulse — 12 May 2025"
```

### Post-call checks (after MCP tool executes)

**Check 4A.3 — fileId is returned and non-empty**
```
After drive.create_file executes:
assert(typeof fileId === 'string')
assert(fileId.length > 0)
assert(!fileId.includes('undefined'))
```

**Check 4A.4 — doc_url is a valid Google Docs URL**
```js
const docUrl = buildDocUrl(fileId)
assert(docUrl.startsWith('https://docs.google.com/document/d/'))
assert(docUrl.endsWith('/edit'))
assert(docUrl.includes(fileId))
```

**Check 4A.5 — Document is accessible**
```
Open doc_url in a browser.
Assert:
- Page loads without 404 or permission error
- Document title matches "Groww Weekly Review Pulse — <week_label>"
- Document body contains the pulse text sections
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| MCP Drive server returns no `fileId` | Retry once; if still no `fileId`, halt with error |
| `pulseText` contains special characters (`━`, `★`, `…`) | These must appear correctly in the Google Doc — not as `?` or garbled |
| `weekLabel` contains a slash (e.g. `12/05/2025`) | Use `DD MMM YYYY` format — no slashes in document name |
| Drive MCP not authenticated | Halt with: "Drive MCP not reachable — check mcp.json config and OAuth" |
| Document already exists with same name | Drive creates a duplicate — this is acceptable (Drive allows duplicate names) |

---

## Phase 4B — Gmail MCP (create_draft)

### Pre-call checks

**Check 4B.1 — Payload is well-formed before calling MCP**
```js
const payload = buildGmailPayload(pulseText, weekLabel, docUrl)
assert(payload.mcpServer === 'gmail')
assert(payload.tool === 'create_draft')
assert(Array.isArray(payload.params.to))
assert(payload.params.to.length > 0)
assert(payload.params.to[0].includes('@'))
assert(payload.params.subject.includes(weekLabel))
assert(payload.params.body.includes(docUrl))
assert(payload.params.body.includes('PULSE SUMMARY'))
assert(!payload.params.body.includes('<DOC_URL_PLACEHOLDER>'))
```

**Check 4B.2 — doc_url is substituted before Gmail call**
```js
// The placeholder must be replaced with the real URL before calling gmail.create_draft
assert(!payload.params.body.includes('<DOC_URL_PLACEHOLDER>'))
assert(payload.params.body.includes('https://docs.google.com/document/d/'))
```

**Check 4B.3 — RECIPIENT_EMAIL is set**
```js
assert(process.env.RECIPIENT_EMAIL, 'RECIPIENT_EMAIL must be set in .env')
assert(process.env.RECIPIENT_EMAIL.includes('@'))
```

### Post-call checks (after MCP tool executes)

**Check 4B.4 — draftId is returned**
```
After gmail.create_draft executes:
assert(typeof draftId === 'string')
assert(draftId.length > 0)
```

**Check 4B.5 — Draft exists in Gmail**
```
Open Gmail → Drafts folder.
Assert:
- Draft exists with subject "Groww Weekly Review Pulse — <week_label>"
- Draft body contains the Google Doc link
- Draft body contains the pulse text
- Draft is NOT sent — it remains in Drafts
```

**Check 4B.6 — No send tool was called**
```
Verify in MCP call log:
- Only 'create_draft' was called on the gmail server
- 'send_message' or any send variant was NOT called
```

### Edge cases

| Edge case | Expected behaviour |
|---|---|
| `RECIPIENT_EMAIL` not set in `.env` | Throw before calling MCP: "RECIPIENT_EMAIL is not set" |
| Gmail MCP not authenticated | Halt with: "Gmail MCP not reachable — check mcp.json config and OAuth" |
| `create_draft` fails on first attempt | Retry once; if still fails, print `pulse_text` to console as fallback |
| `pulseText` is very long (>5000 chars) | Gmail accepts it — no truncation needed for email body |
| `docUrl` is the placeholder string | This is a bug — Phase 4A must complete before Phase 4B starts |

---

## Anti-Hallucination Checks (LLM-specific)

These checks specifically guard against the LLM inventing data that doesn't exist in the reviews.

**Check H.1 — Themes are grounded in actual review content**
```
For each theme returned by Groq:
- Pick 3 random reviews assigned to that theme
- Manually verify the review text is plausibly related to the theme name
- If a theme called "KYC Verification" contains reviews about app crashes, that is a hallucination
```

**Check H.2 — Quotes are verbatim from clean_reviews**
```js
for (const quote of quotes) {
  const source = cleanReviews.find(r => r.text.includes(quote.text.replace('…', '').trim()))
  assert(source !== undefined, `Quote not found in source reviews: "${quote.text}"`)
}
```

**Check H.3 — Action ideas reference real themes**
```js
// Each action idea should mention or clearly relate to one of the top 3 theme names
// This is a manual check — read each idea and verify it's grounded
for (const idea of actionIdeas) {
  const relatedTheme = topThemes.some(t =>
    idea.toLowerCase().includes(t.theme.toLowerCase().split(' ')[0])
  )
  // Log a warning if no theme keyword found — not a hard failure
  if (!relatedTheme) console.warn(`Action idea may not be grounded: "${idea}"`)
}
```

**Check H.4 — No invented statistics in pulse**
```js
// The numbers in the pulse must match the computed stats exactly
for (let i = 0; i < topThemes.length; i++) {
  assert(pulse.includes(String(topThemes[i].review_count)))
  if (topThemes[i].avg_rating !== null) {
    assert(pulse.includes(String(topThemes[i].avg_rating)))
  }
}
```

**Check H.5 — LLM did not add extra sections to pulse**
```js
// The pulse must only contain the 4 defined sections
// Check that no extra headers were injected by the LLM
const forbiddenHeaders = ['RECOMMENDATIONS', 'SUMMARY', 'CONCLUSION', 'INTRODUCTION', 'OVERVIEW']
for (const h of forbiddenHeaders) {
  assert(!pulse.toUpperCase().includes(h), `Unexpected section found in pulse: ${h}`)
}
```

---

## End-to-End Smoke Test

Run this after all phases are implemented. It is the final gate before considering the pipeline done.

```
Step 1: Run node src/index.js
Step 2: Verify console output matches expected sequence (see implementationplan.md)
Step 3: Open output/pulse_YYYY-MM-DD.txt — verify it is readable and complete
Step 4: Check data/raw_reviews.json — verify no PII fields present
Step 5: Agent executes Phase 4 MCP calls
Step 6: Open the Google Doc URL — verify content matches pulse text
Step 7: Open Gmail Drafts — verify draft exists with correct subject and body
Step 8: Verify the draft was NOT sent

Pass criteria:
[ ] No unhandled errors in console
[ ] pulse_text word count ≤ 250
[ ] Google Doc created and accessible
[ ] Gmail draft created and NOT sent
[ ] No PII in any output (reviews JSON, pulse text, email body)
[ ] All 4 required pulse sections present
[ ] Quotes are verbatim from source reviews
[ ] Action ideas reference real themes
```

---

## Quick Reference — What Each Check Catches

| Check | Bug / Hallucination it prevents |
|---|---|
| 1.1 PII stripping | Reviewer names leaking into output |
| 1.2 ID fallback | `undefined` IDs causing dedup failures |
| 2.1 Emoji stripping | Emojis confusing `franc` language detection |
| 2.2 English filter | Hindi/Portuguese reviews polluting themes |
| 2.3 Word count | Single-word reviews like "bad" skewing themes |
| 2.7 Filter order | Emoji-only reviews surviving as empty strings |
| 3A.2 Fence stripping | `JSON.parse` failing on ` ```json ` wrapped output |
| 3A.4 Theme fallback | Reviews with no theme causing `undefined` in pulse |
| 3A.5 Text-only input | Sending full JSON objects bloating the prompt |
| 3C.2 PII in quotes | Email/phone appearing verbatim in the pulse |
| 3D.2 Idea padding | Pulse showing fewer than 3 action ideas |
| 3E.1 Placeholder check | `<week_label>` or `undefined` appearing in final doc |
| 3E.2 Word count | Pulse exceeding 250 words |
| 3E.3 Monday check | Week label pointing to wrong day |
| 4A.3 fileId check | `doc_url` being `undefined` in Gmail body |
| 4B.2 Placeholder check | Gmail body containing literal `<DOC_URL_PLACEHOLDER>` |
| 4B.6 No send check | Email being sent instead of drafted |
| H.2 Quote verbatim | LLM inventing quotes not in source reviews |
| H.4 Stats match | LLM inventing review counts or ratings |
