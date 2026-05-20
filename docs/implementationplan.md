# Groww Review Analyser — Implementation Plan

> **For agents reading this:** This document is the step-by-step build guide. Follow phases in order. Each phase maps directly to a source file. Do not skip ahead. Every code block is production-ready and should be used as-is unless a comment says otherwise.

---

## Prerequisites — Do This Before Writing Any Code

### 1. Initialise the project
```bash
mkdir -p src data output
npm init -y
```

### 2. Install all dependencies
```bash
npm install google-play-scraper franc-min dotenv
```

| Package | Purpose |
|---|---|
| `google-play-scraper` | Fetch Play Store reviews without auth |
| `franc-min` | Lightweight language detection (English filter) |
| `dotenv` | Load `GROQ_API_KEY` from `.env` |

### 3. Create `.env`
```
GROQ_API_KEY=gsk_your_key_here
RECIPIENT_EMAIL=you@example.com
```

### 4. Create `.gitignore`
```
.env
data/
.kiro/settings/mcp.json
node_modules/
```

### 5. Set `"type": "module"` in `package.json`
```json
{
  "type": "module",
  "scripts": {
    "start": "node src/index.js"
  }
}
```

---

## MCP Setup — Do This Before Phase 4

This is a one-time setup. The pipeline cannot deliver to Google Docs or Gmail without it.

### Step 1 — Create a Google Cloud project
Go to [console.cloud.google.com](https://console.cloud.google.com) → New Project → note your `PROJECT_ID`.

### Step 2 — Enable APIs and MCP services
Run these two commands in your terminal (requires `gcloud` CLI installed):
```bash
gcloud services enable gmail.googleapis.com drive.googleapis.com --project=YOUR_PROJECT_ID
gcloud services enable gmailmcp.googleapis.com drivemcp.googleapis.com --project=YOUR_PROJECT_ID
```

### Step 3 — Create OAuth 2.0 credentials
1. Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID
2. Application type: **Desktop app**
3. Copy `Client ID` and `Client Secret`

### Step 4 — Configure OAuth consent screen
1. Cloud Console → Google Auth Platform → Branding → fill in app name
2. Audience → Internal (or External + add your email as test user)
3. Data Access → Add scopes:
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/drive.file`

### Step 5 — Write `.kiro/settings/mcp.json`
```json
{
  "mcpServers": {
    "gmail": {
      "httpUrl": "https://gmailmcp.googleapis.com/mcp/v1",
      "oauth": {
        "enabled": true,
        "clientId": "YOUR_OAUTH_CLIENT_ID",
        "clientSecret": "YOUR_OAUTH_CLIENT_SECRET",
        "scopes": ["https://www.googleapis.com/auth/gmail.compose"]
      }
    },
    "drive": {
      "httpUrl": "https://drivemcp.googleapis.com/mcp/v1",
      "oauth": {
        "enabled": true,
        "clientId": "YOUR_OAUTH_CLIENT_ID",
        "clientSecret": "YOUR_OAUTH_CLIENT_SECRET",
        "scopes": ["https://www.googleapis.com/auth/drive.file"]
      }
    }
  }
}
```

### Step 6 — Authenticate (first run only, in Kiro/Gemini CLI)
```
/mcp auth gmail
/mcp auth drive
```
Follow the browser prompts. After this, tokens are cached and the pipeline can call MCP tools automatically.

---

## Phase 1 — Implement `src/phase1_ingest.js`

### What this file does
Fetches the 150 most recent English Play Store reviews for Groww, maps them to the Data Contract schema, strips PII, and returns a clean array.

### Full implementation
```js
// src/phase1_ingest.js
import gplay from 'google-play-scraper'
import crypto from 'crypto'

const APP_ID      = 'com.nextbillion.groww'
const MAX_REVIEWS = 150

/**
 * Generates a stable ID from text + date when the scraper provides no native ID.
 */
function makeId(text, date) {
  return crypto.createHash('sha1').update(text + date).digest('hex').slice(0, 12)
}

/**
 * Maps a raw scraper result to the shared Data Contract schema.
 * Strips all PII fields (userName, userImage, url, replyDate, replyText).
 */
function mapReview(raw) {
  const date = raw.date instanceof Date
    ? raw.date.toISOString().split('T')[0]
    : String(raw.date).split('T')[0]

  return {
    id:    raw.id ?? makeId(raw.text ?? '', date),
    store: 'play_store',
    rating: raw.score ?? null,
    title:  raw.title ?? null,
    text:   raw.text  ?? '',
    date,
    theme:  null
    // userName, userImage, url intentionally omitted
  }
}

/**
 * Phase 1 entry point.
 * Returns: Review[]  (≤150 items, PII-free)
 */
export async function ingestReviews() {
  console.log('[Phase 1] Fetching Play Store reviews...')

  let result
  let attempts = 0

  while (attempts < 3) {
    try {
      result = await gplay.reviews({
        appId:    APP_ID,
        lang:     'en',
        country:  'in',
        sort:     gplay.Sort.NEWEST,
        num:      MAX_REVIEWS,
        throttle: 10
      })
      break
    } catch (err) {
      attempts++
      if (attempts >= 3) throw new Error(`[Phase 1] Fetch failed after 3 attempts: ${err.message}`)
      console.warn(`[Phase 1] Fetch attempt ${attempts} failed. Retrying in 2s...`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  const raw = result.data ?? result ?? []

  if (!raw.length) {
    throw new Error('[Phase 1] No reviews returned — check app ID and network connection.')
  }

  // Map, deduplicate by id, cap at MAX_REVIEWS
  const seen = new Set()
  const reviews = []

  for (const item of raw) {
    const review = mapReview(item)
    if (!seen.has(review.id)) {
      seen.add(review.id)
      reviews.push(review)
    }
    if (reviews.length >= MAX_REVIEWS) break
  }

  if (reviews.length < 10) {
    console.warn(`[Phase 1] Warning: only ${reviews.length} reviews fetched. Sample is small.`)
  }

  console.log(`[Phase 1] Done. ${reviews.length} reviews ingested.`)
  return reviews
}
```

### What to verify after implementing
- Run `node -e "import('./src/phase1_ingest.js').then(m => m.ingestReviews()).then(r => console.log(r.length, r[0]))"` 
- Should print a count (≤150) and a sample review object with no `userName` field.

---

## Phase 2 — Implement `src/phase2_clean.js`

### What this file does
Takes raw reviews and applies 7 filters in strict order: deduplicate → strip emojis → English-only → minimum 7 words → normalise → truncate → rating sanity. Returns a clean array ready for the LLM.

### Full implementation
```js
// src/phase2_clean.js
import { franc } from 'franc-min'

const MIN_WORDS    = 7
const MAX_CHARS    = 300
const EMOJI_REGEX  = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu
const EN_STOPWORDS = ['the','is','are','was','not','app','and','but','for','with','this','have','has','my','it']

function stripEmojis(str) {
  return (str ?? '').replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim()
}

function isEnglish(text) {
  const lang = franc(text)
  if (lang === 'eng') return true
  if (lang === 'und' && text.length < 20) return true   // too short to detect — keep
  if (lang === 'und') {
    // fallback: stop-word heuristic
    const lower = text.toLowerCase()
    return EN_STOPWORDS.some(w => lower.includes(w))
  }
  return false
}

function truncateAtWord(text, maxChars) {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…'
}

/**
 * Phase 2 entry point.
 * Input:  Review[]  (output of Phase 1)
 * Output: Review[]  (filtered, normalised, emoji-free, English, ≥7 words, ≤300 chars)
 */
export function cleanReviews(rawReviews) {
  console.log(`[Phase 2] Cleaning ${rawReviews.length} reviews...`)

  // Step 1 — Deduplicate on normalised text
  const seenTexts = new Set()
  let reviews = rawReviews.filter(r => {
    const key = (r.text ?? '').toLowerCase().trim()
    if (seenTexts.has(key)) return false
    seenTexts.add(key)
    return true
  })

  // Step 2 — Strip emojis from text and title
  reviews = reviews.map(r => ({
    ...r,
    text:  stripEmojis(r.text),
    title: r.title ? stripEmojis(r.title) : null
  }))

  // Step 3 — English only
  reviews = reviews.filter(r => isEnglish(r.text))

  // Step 4 — Minimum word count (≥7 words)
  reviews = reviews.filter(r => r.text.trim().split(/\s+/).length >= MIN_WORDS)

  // Step 5 — Normalise: lowercase, collapse whitespace
  reviews = reviews.map(r => ({
    ...r,
    text: r.text.toLowerCase().replace(/\s+/g, ' ').trim()
  }))

  // Step 6 — Truncate to MAX_CHARS
  reviews = reviews.map(r => ({
    ...r,
    text: truncateAtWord(r.text, MAX_CHARS)
  }))

  // Step 7 — Rating sanity check
  reviews = reviews.map(r => ({
    ...r,
    rating: Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5
      ? r.rating
      : null
  }))

  if (reviews.length === 0) {
    throw new Error('[Phase 2] All reviews were filtered out — check language filter or review quality.')
  }
  if (reviews.length < 10) {
    console.warn(`[Phase 2] Warning: only ${reviews.length} reviews survived filtering.`)
  }

  console.log(`[Phase 2] Done. ${reviews.length} clean reviews ready.`)
  return reviews
}
```

### What to verify after implementing
- Feed a mix of emoji-heavy, Hindi, and short reviews — they should all be dropped.
- Feed a normal English review — it should survive with lowercase text and no emojis.

---

## Phase 3 — Implement `src/phase3_analyse.js`

### What this file does
Five sub-phases, all in one file:
- **3A** — calls Groq to cluster reviews into 2–5 themes
- **3B** — ranks themes by volume, picks top 3, computes stats (pure JS)
- **3C** — selects one representative quote per top theme (pure JS)
- **3D** — calls Groq to generate 3 action ideas
- **3E** — assembles the final pulse text string (pure JS)

### Groq helper (used by 3A and 3D)
```js
// src/phase3_analyse.js
import 'dotenv/config'

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

async function callGroq(systemPrompt, userPrompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   }
      ]
    })
  })
  if (!res.ok) throw new Error(`[Groq] HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices[0].message.content.trim()
}
```

### Sub-phase 3A — Theme clustering
```js
async function clusterThemes(cleanReviews) {
  console.log('[Phase 3A] Clustering themes via Groq...')

  const SYSTEM = `You are a product analyst. Cluster app reviews into themes.
RULES:
- Produce 2 to 5 themes. Never more than 5.
- Theme names: 1-3 words. e.g. "KYC Verification", "Payment Failures", "App Performance".
- Assign every review to exactly one theme.
- Return ONLY a JSON array. No explanation. No markdown fences. No extra text.
- Format: [{ "theme": "<name>", "review_ids": ["<id>", ...] }]`

  // Send only id + text — never full objects
  const batch = cleanReviews.slice(0, 100).map(r => ({ id: r.id, text: r.text }))
  const USER  = `Reviews:\n${JSON.stringify(batch)}\n\nReturn the JSON array now.`

  let raw = await callGroq(SYSTEM, USER)

  // Strip markdown fences if model wraps output anyway
  raw = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()

  let themes
  try {
    themes = JSON.parse(raw)
  } catch {
    // Retry once with stricter instruction
    const retry = await callGroq(SYSTEM, USER + '\n\nIMPORTANT: Return ONLY valid JSON. No other text.')
    themes = JSON.parse(retry.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim())
  }

  if (!Array.isArray(themes) || themes.length < 2) {
    throw new Error('[Phase 3A] LLM returned fewer than 2 themes.')
  }
  if (themes.length > 5) themes = themes.slice(0, 5)

  // Write theme back onto each review object
  const idToTheme = {}
  for (const t of themes) {
    for (const id of t.review_ids) idToTheme[id] = t.theme
  }
  const themed = cleanReviews.map(r => ({ ...r, theme: idToTheme[r.id] ?? 'Other' }))

  // Build theme_groups
  const groupMap = {}
  for (const r of themed) {
    if (!groupMap[r.theme]) groupMap[r.theme] = []
    groupMap[r.theme].push(r)
  }
  const themeGroups = Object.entries(groupMap).map(([theme, reviews]) => ({ theme, reviews }))

  console.log(`[Phase 3A] Done. ${themeGroups.length} themes identified.`)
  return { themedReviews: themed, themeGroups }
}
```

### Sub-phase 3B — Rank and compute stats
```js
function rankThemes(themeGroups) {
  console.log('[Phase 3B] Ranking themes...')

  const ranked = [...themeGroups].sort((a, b) => b.reviews.length - a.reviews.length)
  const top3   = ranked.slice(0, 3).map(g => {
    const ratings = g.reviews.map(r => r.rating).filter(r => r !== null)
    const avg     = ratings.length
      ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
      : null
    const lowPct  = ratings.length
      ? Math.round((ratings.filter(r => r <= 2).length / ratings.length) * 100)
      : null

    return { theme: g.theme, review_count: g.reviews.length, avg_rating: avg, low_rating_pct: lowPct, reviews: g.reviews }
  })

  console.log(`[Phase 3B] Top 3: ${top3.map(t => t.theme).join(', ')}`)
  return top3
}
```

### Sub-phase 3C — Select quotes
```js
const PII_REGEX = /\b[\w.+-]+@[\w-]+\.\w+\b|\b\d{10}\b/

function selectQuotes(topThemes) {
  console.log('[Phase 3C] Selecting quotes...')

  return topThemes.map(t => {
    const candidates = [...t.reviews].sort((a, b) => (a.rating ?? 5) - (b.rating ?? 5))
    let chosen = candidates.find(r => {
      const len = r.text.length
      return r.rating <= 2 && len >= 30 && len <= 150 && !PII_REGEX.test(r.text)
    })
    if (!chosen) chosen = candidates.find(r => !PII_REGEX.test(r.text))
    if (!chosen) chosen = candidates[0]

    let quote = chosen.text
    if (quote.length > 150) quote = quote.slice(0, 150).trimEnd() + '…'

    return { theme: t.theme, text: quote }
  })
}
```

### Sub-phase 3D — Generate action ideas
```js
async function generateActionIdeas(topThemes, quotes) {
  console.log('[Phase 3D] Generating action ideas via Groq...')

  const SYSTEM = `You are a senior product manager at a fintech app.
RULES:
- Generate exactly 3 action ideas.
- Each must be concrete and specific — not generic advice.
- Each must be grounded in one of the themes below.
- Format: numbered list. Each item: one sentence, 25 words max.
- Return ONLY the numbered list. No preamble, no explanation.`

  const themeSummary = topThemes.map((t, i) =>
    `${i+1}. ${t.theme} — ${t.review_count} reviews | Avg: ${t.avg_rating ?? 'N/A'}★ | ${t.low_rating_pct ?? 'N/A'}% rated ≤2★`
  ).join('\n')

  const quoteSummary = quotes.map(q => `[${q.theme}] "${q.text}"`).join('\n')

  const USER = `Top themes:\n${themeSummary}\n\nUser quotes:\n${quoteSummary}\n\nGenerate 3 action ideas now.`

  const raw = await callGroq(SYSTEM, USER)
  const ideas = raw.split('\n')
    .filter(l => /^\d+\./.test(l.trim()))
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)

  while (ideas.length < 3) {
    const t = topThemes[ideas.length] ?? topThemes[0]
    ideas.push(`Investigate ${t.theme} further with the product team.`)
  }

  console.log('[Phase 3D] Done. 3 action ideas generated.')
  return ideas
}
```

### Sub-phase 3E — Assemble pulse
```js
function assemblePulse(cleanReviews, topThemes, quotes, actionIdeas) {
  console.log('[Phase 3E] Assembling pulse document...')

  const today    = new Date()
  const monday   = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const weekLabel = monday.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })

  const sep   = '━'.repeat(40)
  const lines = [
    'GROWW APP — WEEKLY REVIEW PULSE',
    `Week of: ${weekLabel}`,
    `Reviews analysed: ${cleanReviews.length}`,
    `Source: Google Play Store | Latest ${cleanReviews.length} reviews`,
    '',
    sep,
    'TOP THEMES THIS WEEK',
    sep,
    '',
    ...topThemes.map((t, i) =>
      `${i+1}. ${t.theme} — ${t.review_count} reviews | Avg: ${t.avg_rating ?? 'N/A'}★ | ${t.low_rating_pct ?? 'N/A'}% rated ≤2★`
    ),
    '',
    sep,
    'WHAT USERS ARE SAYING (verbatim, anonymised)',
    sep,
    '',
    ...quotes.map(q => `[${q.theme}] "${q.text}"`),
    '',
    sep,
    'ACTION IDEAS',
    sep,
    '',
    ...actionIdeas.map((a, i) => `${i+1}. ${a}`),
    '',
    sep,
    'Generated by Groww Review Analyser.'
  ]

  const pulse = lines.join('\n')
  console.log('[Phase 3E] Done. Pulse assembled.')
  return { pulse_text: pulse, week_label: weekLabel }
}
```

### Phase 3 orchestrator (exported function)
```js
export async function analyseAndWritePulse(cleanReviews) {
  const { themedReviews, themeGroups } = await clusterThemes(cleanReviews)
  const topThemes  = rankThemes(themeGroups)
  const quotes     = selectQuotes(topThemes)
  const actionIdeas = await generateActionIdeas(topThemes, quotes)
  return assemblePulse(themedReviews, topThemes, quotes, actionIdeas)
}
```

---

## Phase 4 — Implement `src/phase4_deliver.js`

### What this file does
Calls two MCP tools in sequence:
1. `drive.create_file` — creates a Google Doc with the pulse content
2. `gmail.create_draft` — creates a Gmail draft with the pulse and a link to the Doc

### How MCP tool calls work in this pipeline
The agent (Kiro) has the MCP servers configured in `.kiro/settings/mcp.json`. When the code calls an MCP tool, it goes through the MCP client layer — not a direct HTTP call from your code. The pattern is:

```
Your code calls → MCP client (Kiro) → Google Workspace MCP server → Google API
```

Because of this, `phase4_deliver.js` does **not** make raw `fetch()` calls to googleapis.com. Instead, it exports functions that describe what MCP tool to call and with what parameters. The agent executes those calls using its MCP tool access.

### Implementation pattern
```js
// src/phase4_deliver.js

/**
 * Phase 4A — Create a Google Doc via Drive MCP.
 *
 * The agent must call the MCP tool:
 *   Server:  drive  (https://drivemcp.googleapis.com/mcp/v1)
 *   Tool:    create_file
 *   Params:  { name, mimeType, content }
 *
 * This function returns the parameters to pass to the MCP tool.
 * The agent executes the actual MCP call and passes the result back.
 */
export function buildDrivePayload(pulseText, weekLabel) {
  return {
    mcpServer: 'drive',
    tool: 'create_file',
    params: {
      name:     `Groww Weekly Review Pulse — ${weekLabel}`,
      mimeType: 'application/vnd.google-apps.document',
      content:  pulseText
    }
  }
}

/**
 * Constructs the shareable Google Docs URL from a Drive fileId.
 */
export function buildDocUrl(fileId) {
  return `https://docs.google.com/document/d/${fileId}/edit`
}

/**
 * Phase 4B — Create a Gmail draft via Gmail MCP.
 *
 * The agent must call the MCP tool:
 *   Server:  gmail  (https://gmailmcp.googleapis.com/mcp/v1)
 *   Tool:    create_draft
 *   Params:  { to, subject, body }
 *
 * This function returns the parameters to pass to the MCP tool.
 */
export function buildGmailPayload(pulseText, weekLabel, docUrl) {
  const body = [
    'Hi,',
    '',
    "This week's Groww app review pulse is ready.",
    '',
    `Read it here: ${docUrl}`,
    '',
    '--- PULSE SUMMARY ---',
    '',
    pulseText,
    '',
    '---',
    'Sent by Groww Review Analyser (automated).'
  ].join('\n')

  return {
    mcpServer: 'gmail',
    tool: 'create_draft',
    params: {
      to:      [process.env.RECIPIENT_EMAIL],
      subject: `Groww Weekly Review Pulse — ${weekLabel}`,
      body
    }
  }
}
```

### How the agent uses these payloads
When `src/index.js` calls Phase 4, it logs the MCP payloads. The agent (Kiro) reads these and executes the MCP tool calls directly using its built-in MCP client. The agent then captures `fileId` from the Drive response and `draftId` from the Gmail response.

---

## Pipeline Orchestrator — Implement `src/index.js`

### What this file does
Imports all four phases and runs them in sequence. Saves intermediate outputs to `data/` and `output/` for debugging. Logs the final `doc_url` and `draft_id`.

```js
// src/index.js
import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'fs'
import { ingestReviews }         from './phase1_ingest.js'
import { cleanReviews }          from './phase2_clean.js'
import { analyseAndWritePulse }  from './phase3_analyse.js'
import { buildDrivePayload, buildDocUrl, buildGmailPayload } from './phase4_deliver.js'

async function run() {
  console.log('=== Groww Review Analyser — Starting ===\n')

  // ── Phase 1 ──────────────────────────────────────────────────────────
  const rawReviews = await ingestReviews()
  mkdirSync('data', { recursive: true })
  writeFileSync('data/raw_reviews.json', JSON.stringify(rawReviews, null, 2))
  console.log(`Saved ${rawReviews.length} raw reviews to data/raw_reviews.json\n`)

  // ── Phase 2 ──────────────────────────────────────────────────────────
  const cleanedReviews = cleanReviews(rawReviews)
  console.log()

  // ── Phase 3 ──────────────────────────────────────────────────────────
  const { pulse_text, week_label } = await analyseAndWritePulse(cleanedReviews)
  mkdirSync('output', { recursive: true })
  const outFile = `output/pulse_${new Date().toISOString().split('T')[0]}.txt`
  writeFileSync(outFile, pulse_text)
  console.log(`\nPulse saved locally to ${outFile}\n`)
  console.log('─── PULSE PREVIEW ───')
  console.log(pulse_text)
  console.log('─────────────────────\n')

  // ── Phase 4 ──────────────────────────────────────────────────────────
  // Build MCP payloads — the agent executes these tool calls
  const drivePayload = buildDrivePayload(pulse_text, week_label)
  const gmailPayload = buildGmailPayload(pulse_text, week_label, '<DOC_URL_PLACEHOLDER>')

  console.log('[Phase 4] MCP tool calls to execute:\n')
  console.log('4A — Drive MCP:')
  console.log(JSON.stringify(drivePayload, null, 2))
  console.log('\n4B — Gmail MCP:')
  console.log(JSON.stringify(gmailPayload, null, 2))

  // Agent instruction: after calling drive.create_file, replace <DOC_URL_PLACEHOLDER>
  // with buildDocUrl(fileId) and then call gmail.create_draft with the updated payload.

  console.log('\n=== Pipeline complete. Agent: execute the MCP calls above. ===')
}

run().catch(err => {
  console.error('\n[FATAL]', err.message)
  process.exit(1)
})
```

---

## Running the Pipeline

```bash
node src/index.js
```

Expected console output sequence:
```
=== Groww Review Analyser — Starting ===

[Phase 1] Fetching Play Store reviews...
[Phase 1] Done. 150 reviews ingested.
Saved 150 raw reviews to data/raw_reviews.json

[Phase 2] Cleaning 150 reviews...
[Phase 2] Done. 112 clean reviews ready.

[Phase 3A] Clustering themes via Groq...
[Phase 3A] Done. 4 themes identified.
[Phase 3B] Top 3: KYC Verification, Payment Failures, App Performance
[Phase 3C] Selecting quotes...
[Phase 3D] Generating action ideas via Groq...
[Phase 3E] Assembling pulse document...

Pulse saved locally to output/pulse_2025-05-12.txt

─── PULSE PREVIEW ───
GROWW APP — WEEKLY REVIEW PULSE
...
─────────────────────

[Phase 4] MCP tool calls to execute:
4A — Drive MCP: { ... }
4B — Gmail MCP: { ... }

=== Pipeline complete. Agent: execute the MCP calls above. ===
```

After the script completes, the agent (Kiro) reads the Phase 4 MCP payloads from the output and executes:
1. `drive.create_file` → captures `fileId` → builds `doc_url`
2. `gmail.create_draft` → captures `draft_id`

---

## Final File Structure After Implementation

```
Review-Analyser-/
├── docs/
│   ├── project-brief.md
│   ├── architecture.md
│   └── implementationplan.md       ← this file
├── src/
│   ├── index.js                    ← pipeline orchestrator
│   ├── phase1_ingest.js            ← Play Store fetch + schema mapping
│   ├── phase2_clean.js             ← emoji strip, English filter, word count, normalise
│   ├── phase3_analyse.js           ← Groq clustering + stats + quotes + action ideas + pulse
│   └── phase4_deliver.js           ← MCP payload builders for Drive + Gmail
├── data/
│   └── raw_reviews.json            ← Phase 1 output (gitignored)
├── output/
│   └── pulse_YYYY-MM-DD.txt        ← Phase 3 output (local copy)
├── .kiro/
│   └── settings/
│       └── mcp.json                ← Google Workspace MCP config (gitignored)
├── .env                            ← GROQ_API_KEY + RECIPIENT_EMAIL (gitignored)
├── .gitignore
└── package.json
```

---

## Dependency Summary

```json
{
  "dependencies": {
    "google-play-scraper": "latest",
    "franc-min": "latest",
    "dotenv": "latest"
  }
}
```

No Google API client libraries. No OAuth libraries. No MCP SDK in application code — MCP is handled entirely by the Kiro agent layer via `.kiro/settings/mcp.json`.

---

## Common Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `No reviews returned` | Wrong app ID or network block | Verify `com.nextbillion.groww` is correct; try from a different network |
| `franc is not a function` | Wrong import style | Use `import { franc } from 'franc-min'` not default import |
| `JSON.parse error` in Phase 3A | Groq wrapped JSON in markdown | The retry logic strips ` ```json ` fences — check the raw response log |
| `GROQ_API_KEY is undefined` | `.env` not loaded | Ensure `import 'dotenv/config'` is the first line in `index.js` |
| `Drive MCP not reachable` | MCP not authenticated | Run `/mcp auth drive` in Kiro and complete the browser OAuth flow |
| `Gmail MCP not reachable` | MCP not authenticated | Run `/mcp auth gmail` in Kiro and complete the browser OAuth flow |
| `All reviews filtered out` | `franc-min` dropping too many | Check if reviews are actually English; lower `MIN_WORDS` temporarily to debug |
| Groq rate limit `429` | Too many requests per minute | Add `await new Promise(r => setTimeout(r, 3000))` between the two Groq calls |

---

## Implementation Order Checklist

```
[ ] 1. npm init + install dependencies
[ ] 2. Create .env with GROQ_API_KEY and RECIPIENT_EMAIL
[ ] 3. Create .gitignore
[ ] 4. Set "type": "module" in package.json
[ ] 5. Implement src/phase1_ingest.js — test standalone
[ ] 6. Implement src/phase2_clean.js — test standalone
[ ] 7. Implement src/phase3_analyse.js — test standalone (needs GROQ_API_KEY)
[ ] 8. Implement src/phase4_deliver.js
[ ] 9. Implement src/index.js
[ ] 10. Run: node src/index.js — verify pulse output in console and output/ folder
[ ] 11. Complete MCP setup (Google Cloud project, OAuth, mcp.json, /mcp auth)
[ ] 12. Agent executes Phase 4 MCP calls — verify Google Doc created and Gmail draft exists
```
