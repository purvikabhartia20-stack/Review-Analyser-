# Groww Review Analyser — Decision Log

> Every significant business or technical decision made during the design and planning of this project is recorded here. Each entry explains what was decided, why, what was rejected, and what the trade-offs are. Newest decisions are at the top.

---

## How to Read This Log

| Field | Meaning |
|---|---|
| **ID** | Unique reference (D-001, D-002, …) |
| **Date** | When the decision was made |
| **Type** | `Tech` or `Business` |
| **Status** | `Active` — in effect now / `Superseded` — replaced by a later decision |
| **Decision** | What was decided |
| **Context** | Why this decision was needed |
| **Alternatives considered** | What else was evaluated |
| **Reason for choice** | Why this option won |
| **Trade-offs** | What we gave up |
| **Supersedes** | Which earlier decision this replaces (if any) |

---

## D-010 — `gplay.sort.NEWEST` not `gplay.Sort.NEWEST`

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Decision:** Use `gplay.sort.NEWEST` (lowercase `sort`) when calling `google-play-scraper`.
- **Context:** The implementation plan and architecture doc referenced `gplay.Sort.NEWEST` (capitalised). The actual package exports the sort enum as `gplay.sort` (lowercase). Discovered during integration testing — the fetch failed with `Cannot read properties of undefined (reading 'NEWEST')`.
- **Fix applied in:** `src/phase1/phase1_ingest.js`
- **Trade-offs:** None — this is a straight correction.

---

## D-009 — Minimum 7 words per review (not 6)

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Decision:** Drop any review with fewer than 7 words after cleaning.
- **Context:** User specified "more than 6 words". Implemented as `>= 7` which is mathematically equivalent. The threshold removes noise like "bad app", "not working", "1 star" that carry no actionable signal for the LLM.
- **Alternatives considered:**
  - 5 words — too permissive, short phrases still noisy
  - 10 words — too aggressive, drops valid short feedback like "kyc stuck for days, no help"
- **Reason for choice:** 7 words is the minimum for a review to contain a subject, verb, and enough context for the LLM to assign a meaningful theme.
- **Trade-offs:** Some valid short reviews (e.g. "payment failed three times today") are dropped. Acceptable — the LLM benefits more from quality than quantity.

---

## D-008 — Emoji stripping before language detection

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Decision:** Strip emojis from review text as a separate step, before running `franc` language detection.
- **Context:** User requested emoji removal. `franc` uses character frequency analysis — emoji-heavy text confuses it and causes valid English reviews to be misclassified as `'und'` (undetermined) or dropped.
- **Alternatives considered:**
  - Strip emojis after language detection — `franc` would misclassify emoji-heavy English reviews
  - Skip emoji stripping entirely — emojis pollute LLM prompts and inflate token count
- **Reason for choice:** Stripping first gives `franc` clean text to analyse, improving detection accuracy.
- **Trade-offs:** A review that is *only* emojis becomes an empty string after stripping, then fails the word count filter and is dropped. This is the correct behaviour.
- **Filter order enforced:** deduplicate → strip emojis → language filter → word count → normalise → truncate → rating check

---

## D-007 — English-only reviews using `franc-min`

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Decision:** Use `franc-min` npm package for language detection. Keep only reviews where `franc(text) === 'eng'`. Fall back to a stop-word heuristic if `franc` is unavailable.
- **Context:** User explicitly requested English-only reviews. Play Store India reviews contain significant Hindi, Hinglish, and other regional language content.
- **Alternatives considered:**
  - Pass `lang: 'en'` to `google-play-scraper` only — the scraper's language filter is unreliable; non-English reviews still slip through
  - `langdetect` npm package — heavier, less accurate on short texts
  - No language filter — LLM would cluster non-English reviews into a "foreign language" theme, wasting one of the 5 theme slots
- **Reason for choice:** `franc-min` is lightweight (~50kb), works well on texts ≥ 20 characters, and has no external dependencies.
- **Trade-offs:** `franc` returns `'und'` for very short texts (< 20 chars). Decision: keep `'und'` texts under 20 chars (likely short English phrases). Drop `'und'` texts over 20 chars that don't match English stop words.

---

## D-006 — Groq API with `llama-3.3-70b-versatile`

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Decision:** Use Groq API as the LLM provider. Model: `llama-3.3-70b-versatile`. Temperature: `0.2`.
- **Context:** User specified a free model. Groq offers the most generous free tier for a capable model: 128k context window, ~500 tokens/sec, 14,400 requests/day, no credit card required.
- **Alternatives considered:**
  - OpenAI GPT-4o-mini — requires paid tier for reliable access
  - Google Gemini Flash — free tier available but requires Google Cloud project setup (already needed for MCP, but adds complexity)
  - Ollama (local) — no API cost but requires local GPU/CPU, not portable
  - Mistral API — free tier exists but smaller context window
- **Reason for choice:** Groq free tier is the most capable option with zero cost and minimal setup. The 128k context window means our 150-review pipeline fits comfortably in a single call.
- **Trade-offs:** Groq free tier has a 6,000 tokens/minute rate limit. Our pipeline makes 2 LLM calls per run — well within limits. If Groq changes pricing, the `callGroq()` helper is the only function that needs updating.
- **Temperature rationale:** `0.2` keeps output deterministic and structured. Higher temperatures cause the model to deviate from the JSON format instruction.

---

## D-005 — Play Store only (App Store dropped)

- **Date:** 2026-05-17
- **Type:** Business + Tech
- **Status:** Active
- **Supersedes:** Original brief which specified both App Store and Play Store
- **Decision:** Ingest reviews from Google Play Store only. App Store integration is removed entirely.
- **Context:** User confirmed Play Store only is sufficient. Groww's primary user base is Android (India market). Combining two stores adds complexity without proportional signal gain.
- **Alternatives considered:**
  - Both stores — doubles ingestion complexity, requires two different data shapes, App Store RSS feed is paginated differently and less reliable
  - App Store only — Groww's Android user base is larger in India
- **Reason for choice:** Simpler pipeline, single data shape, single scraper library, no RSS pagination. The 150-review cap is more meaningful when all reviews come from one consistent source.
- **Trade-offs:** iOS-specific issues (e.g. App Store payment flow differences) will not appear in the pulse. Acceptable for the current scope.

---

## D-004 — 150 review cap

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Decision:** Hard cap ingestion at 150 reviews. Sort by `NEWEST` so the 150 most recent reviews are always fetched.
- **Context:** Originally set to manage free-model context limits. With Groq's 128k window this is no longer a hard technical constraint, but it remains a good practice for speed, cost, and rate-limit safety.
- **Alternatives considered:**
  - 500 reviews — exceeds Groq's 6,000 tokens/minute rate limit in a single call
  - 50 reviews — too small a sample for reliable theme clustering
  - No cap — unpredictable run time, risk of hitting scraper rate limits
- **Reason for choice:** 150 reviews × ~100 tokens each ≈ 15k tokens. After Phase 2 filtering, typically 80–120 reviews reach the LLM. This is a comfortable, fast, and reproducible sample size.
- **Trade-offs:** Reviews older than the most recent 150 are ignored. For a weekly pulse this is acceptable — we want recency, not historical depth.

---

## D-003 — Official Google Workspace remote MCP servers

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Supersedes:** D-003-draft which used `@modelcontextprotocol/server-gdrive` npm package
- **Decision:** Use Google's official remote MCP servers hosted at `gmailmcp.googleapis.com` and `drivemcp.googleapis.com`. Configure via `httpUrl` + `oauth` in `mcp.json`. Do not install any npm MCP package for Google services.
- **Context:** The original architecture referenced `@modelcontextprotocol/server-gdrive` — this package does not exist as described. Google launched official remote MCP servers in May 2026 which are the correct integration path.
- **Alternatives considered:**
  - `@modelcontextprotocol/server-gdrive` npm — does not exist / not maintained by Google
  - `mcp-gsuite` (MarkusPfundstein) — community package, Gmail + Calendar only, no Docs
  - `google_workspace_mcp` (taylorwilsdon) — community package, broader but unofficial
  - Hand-rolled Google API client — violates the MCP-first constraint
- **Reason for choice:** Official Google servers are the only option that is maintained by Google, uses standard OAuth 2.0, and is guaranteed to stay compatible with the Google Workspace API surface.
- **Trade-offs:** Requires a Google Cloud project and OAuth consent screen setup (one-time, ~15 minutes). The Drive MCP server does not expose a `create_document` tool — we use `create_file` with `mimeType: application/vnd.google-apps.document` instead, which Drive converts automatically.
- **Tools used:**
  - `drive.create_file` — creates the Google Doc
  - `gmail.create_draft` — creates the Gmail draft

---

## D-002 — MCP-first delivery (no hand-rolled API clients)

- **Date:** 2026-05-17
- **Type:** Tech
- **Status:** Active
- **Decision:** All Google Workspace interactions (Docs, Gmail) must go through MCP servers. No bespoke OAuth client, no direct REST calls to `googleapis.com` from application code.
- **Context:** Project brief explicitly requires MCP-first integration. This is also the correct architectural choice — MCP handles auth token refresh, retry, and API versioning automatically.
- **Alternatives considered:**
  - Google API Node.js client (`googleapis` npm) — requires managing OAuth tokens, refresh logic, and API versioning in application code
  - `nodemailer` for Gmail — does not support OAuth 2.0 easily, not MCP
- **Reason for choice:** MCP servers expose tools the agent can call directly. No auth plumbing in application code. Consistent with the course tooling requirement.
- **Trade-offs:** Requires one-time Google Cloud project setup. MCP servers are in Developer Preview — tool names or parameters may change. Mitigated by documenting exact tool names in `architecture.md`.

---

## D-001 — Weekly pulse format (≤ 250 words, 3 themes, 3 quotes, 3 actions)

- **Date:** 2026-05-17
- **Type:** Business
- **Status:** Active
- **Decision:** The pulse document is capped at 250 words and must contain exactly: top 3 themes with stats, 3 verbatim anonymised quotes (one per theme), and 3 action ideas.
- **Context:** Defined in the original project brief. The format is designed to be scannable in under 2 minutes by a product manager or executive.
- **Alternatives considered:**
  - 5 themes, 5 quotes — too long, loses scannability
  - 1 theme, 1 quote — too narrow, misses the breadth of user feedback
  - Free-form summary — harder to compare week-over-week
- **Reason for choice:** The 3/3/3 structure (themes/quotes/actions) is a proven product management format. Fixed structure makes it easy to compare pulses across weeks.
- **Trade-offs:** If fewer than 3 themes are identified (rare), the pulse shows 2 themes. Action ideas are padded with a fallback string if the LLM returns fewer than 3. Both are handled gracefully in the code.
- **Privacy constraint:** Quotes must be anonymised — no usernames, emails, device IDs, or any PII. Enforced by PII regex check in Phase 3C before a quote is selected.
