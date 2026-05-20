// src/phase3/phase3_analyse.js
// Phase 3 — Analyse and Write Pulse
// Sub-phases: 3A cluster → 3B rank → 3C quotes → 3D action ideas → 3E assemble

import 'dotenv/config'

// ─── Constants ────────────────────────────────────────────────────────────────
const GROQ_URL        = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL      = 'llama-3.3-70b-versatile'
const LLM_TEMPERATURE = 0.2
const MAX_BATCH       = 100   // max reviews per LLM call
const MAX_THEMES      = 5
const TOP_N           = 3
const MAX_QUOTE_LEN   = 150
const PII_REGEX       = /\b[\w.+-]+@[\w-]+\.\w+\b|\b\d{10}\b/

// ─── Groq helper ──────────────────────────────────────────────────────────────

/**
 * Calls the Groq API with a system + user prompt.
 * Throws on non-2xx HTTP or missing API key.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} raw text response from the model
 */
export async function callGroq(systemPrompt, userPrompt) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('[Groq] GROQ_API_KEY is not set — add it to your .env file.')
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      temperature: LLM_TEMPERATURE,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) throw new Error('[Groq] Auth failed — check GROQ_API_KEY.')
    if (res.status === 429) throw new Error('[Groq] Rate limit hit (429) — wait and retry.')
    throw new Error(`[Groq] HTTP ${res.status}: ${body}`)
  }

  const data = await res.json()
  return data.choices[0].message.content.trim()
}

/**
 * Strips markdown code fences from a string (```json ... ``` or ``` ... ```).
 * @param {string} str
 * @returns {string}
 */
export function stripFences(str) {
  return str.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

// ─── Sub-phase 3A — Theme Clustering ─────────────────────────────────────────

const CLUSTER_SYSTEM = `You are a product analyst. Cluster app reviews into themes.
RULES:
- Produce 2 to 5 themes. Never more than 5.
- Theme names: 1-3 words. e.g. "KYC Verification", "Payment Failures", "App Performance".
- Assign every review to exactly one theme.
- Return ONLY a JSON array. No explanation. No markdown fences. No extra text.
- Format: [{ "theme": "<name>", "review_ids": ["<id>", ...] }]
- Do not invent themes not supported by the reviews.`

/**
 * Clusters reviews into 2–5 themes via Groq.
 * Sends only { id, text } — never full review objects.
 *
 * @param {object[]} cleanReviews
 * @returns {Promise<{ themedReviews: object[], themeGroups: object[] }>}
 */
export async function clusterThemes(cleanReviews) {
  console.log('[Phase 3A] Clustering themes via Groq...')

  const batch = cleanReviews.slice(0, MAX_BATCH).map(r => ({ id: r.id, text: r.text }))
  const USER  = `Reviews:\n${JSON.stringify(batch)}\n\nReturn the JSON array now.`

  let raw = await callGroq(CLUSTER_SYSTEM, USER)
  raw = stripFences(raw)

  let themes
  try {
    themes = JSON.parse(raw)
  } catch {
    // Retry once with stricter instruction
    console.warn('[Phase 3A] JSON parse failed — retrying with stricter instruction...')
    const retry = await callGroq(CLUSTER_SYSTEM, USER + '\n\nIMPORTANT: Return ONLY valid JSON. No other text.')
    themes = JSON.parse(stripFences(retry))
  }

  if (!Array.isArray(themes) || themes.length < 2) {
    throw new Error('[Phase 3A] LLM returned fewer than 2 themes.')
  }
  if (themes.length > MAX_THEMES) themes = themes.slice(0, MAX_THEMES)

  // Map review IDs to their theme
  const idToTheme = {}
  for (const t of themes) {
    for (const id of (t.review_ids ?? [])) idToTheme[id] = t.theme
  }

  // Write theme back onto each review; fallback to 'Other' for any unmapped ID
  const themedReviews = cleanReviews.map(r => ({ ...r, theme: idToTheme[r.id] ?? 'Other' }))

  // Build theme_groups
  const groupMap = {}
  for (const r of themedReviews) {
    if (!groupMap[r.theme]) groupMap[r.theme] = []
    groupMap[r.theme].push(r)
  }
  const themeGroups = Object.entries(groupMap).map(([theme, reviews]) => ({ theme, reviews }))

  console.log(`[Phase 3A] Done. ${themeGroups.length} themes: ${themeGroups.map(g => g.theme).join(', ')}`)
  return { themedReviews, themeGroups }
}

// ─── Sub-phase 3B — Rank and Select Top 3 ────────────────────────────────────

/**
 * Sorts theme groups by review count, takes top 3, computes stats.
 * Pure computation — no LLM call.
 *
 * @param {object[]} themeGroups
 * @returns {object[]} top_themes with review_count, avg_rating, low_rating_pct
 */
export function rankThemes(themeGroups) {
  console.log('[Phase 3B] Ranking themes...')

  const ranked = [...themeGroups].sort((a, b) => b.reviews.length - a.reviews.length)
  const topN   = ranked.slice(0, TOP_N).map(g => {
    const ratings = g.reviews.map(r => r.rating).filter(r => r !== null)
    const avg     = ratings.length
      ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
      : null
    const lowPct  = ratings.length
      ? Math.round((ratings.filter(r => r <= 2).length / ratings.length) * 100)
      : null

    return {
      theme:          g.theme,
      review_count:   g.reviews.length,
      avg_rating:     avg,
      low_rating_pct: lowPct,
      reviews:        g.reviews
    }
  })

  console.log(`[Phase 3B] Top ${topN.length}: ${topN.map(t => t.theme).join(', ')}`)
  return topN
}

// ─── Sub-phase 3C — Select Quotes ────────────────────────────────────────────

/**
 * Selects one representative quote per top theme.
 * Prefers low-rated (≤2★), 30–150 char, PII-free reviews.
 * Pure logic — no LLM call.
 *
 * @param {object[]} topThemes
 * @returns {object[]} quotes — [{ theme, text }]
 */
export function selectQuotes(topThemes) {
  console.log('[Phase 3C] Selecting quotes...')

  return topThemes.map(t => {
    // Sort by rating ascending (worst first) so we prefer pain points
    const candidates = [...t.reviews].sort((a, b) => (a.rating ?? 5) - (b.rating ?? 5))

    // Ideal: low rating + right length + no PII
    let chosen = candidates.find(r =>
      r.rating <= 2 &&
      r.text.length >= 30 &&
      r.text.length <= MAX_QUOTE_LEN &&
      !PII_REGEX.test(r.text)
    )
    // Fallback 1: any non-PII review
    if (!chosen) chosen = candidates.find(r => !PII_REGEX.test(r.text))
    // Fallback 2: first review regardless
    if (!chosen) chosen = candidates[0]

    let quote = chosen.text
    if (quote.length > MAX_QUOTE_LEN) quote = quote.slice(0, MAX_QUOTE_LEN).trimEnd() + '…'

    return { theme: t.theme, text: quote }
  })
}

// ─── Sub-phase 3D — Generate Action Ideas ────────────────────────────────────

const ACTION_SYSTEM = `You are a senior product manager at a fintech app.
RULES:
- Generate exactly 3 action ideas.
- Each must be concrete and specific — not generic advice.
- Each must be grounded in one of the themes below.
- Format: numbered list. Each item: one sentence, 25 words max.
- Return ONLY the numbered list. No preamble, no explanation.`

/**
 * Generates 3 action ideas via Groq.
 * Sends only theme summaries and quotes — never full review texts.
 *
 * @param {object[]} topThemes
 * @param {object[]} quotes
 * @returns {Promise<string[]>} exactly 3 action idea strings
 */
export async function generateActionIdeas(topThemes, quotes) {
  console.log('[Phase 3D] Generating action ideas via Groq...')

  const themeSummary = topThemes.map((t, i) =>
    `${i + 1}. ${t.theme} — ${t.review_count} reviews | Avg: ${t.avg_rating ?? 'N/A'}★ | ${t.low_rating_pct ?? 'N/A'}% rated ≤2★`
  ).join('\n')

  const quoteSummary = quotes.map(q => `[${q.theme}] "${q.text}"`).join('\n')

  const USER = `Top themes:\n${themeSummary}\n\nUser quotes:\n${quoteSummary}\n\nGenerate 3 action ideas now.`

  const raw = await callGroq(ACTION_SYSTEM, USER)

  // Parse numbered list — also handle bullet lists (- item)
  let ideas = raw.split('\n')
    .map(l => l.trim())
    .filter(l => /^(\d+[.)]\s*|[-•]\s*)/.test(l))
    .map(l => l.replace(/^(\d+[.)]\s*|[-•]\s*)/, '').trim())
    .filter(Boolean)
    .slice(0, 3)

  // If still no numbered items, split on newlines and take first 3 non-empty
  if (ideas.length === 0) {
    ideas = raw.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3)
  }

  // Pad to 3 if needed
  while (ideas.length < 3) {
    const t = topThemes[ideas.length] ?? topThemes[0]
    ideas.push(`Investigate ${t.theme} further with the product team.`)
  }

  console.log('[Phase 3D] Done. 3 action ideas generated.')
  return ideas
}

// ─── Sub-phase 3E — Assemble Pulse ───────────────────────────────────────────

/**
 * Assembles the final pulse text string from computed data.
 * Pure string building — no LLM call.
 *
 * @param {object[]} cleanReviews
 * @param {object[]} topThemes
 * @param {object[]} quotes
 * @param {string[]} actionIdeas
 * @returns {{ pulse_text: string, week_label: string }}
 */
export function assemblePulse(cleanReviews, topThemes, quotes, actionIdeas) {
  console.log('[Phase 3E] Assembling pulse document...')

  // Compute Monday of the current week
  const today  = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const weekLabel = monday.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  })

  const sep = '━'.repeat(40)

  const formatThemeLine = (t, i) => {
    const avg = t.avg_rating     !== null ? `${t.avg_rating}★`     : 'N/A'
    const pct = t.low_rating_pct !== null ? `${t.low_rating_pct}%` : 'N/A'
    return `${i + 1}. ${t.theme} — ${t.review_count} reviews | Avg: ${avg} | ${pct} rated ≤2★`
  }

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
    ...topThemes.map((t, i) => formatThemeLine(t, i)),
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
    ...actionIdeas.map((a, i) => `${i + 1}. ${a}`),
    '',
    sep,
    'Generated by Groww Review Analyser.'
  ]

  const pulse_text = lines.join('\n')
  console.log('[Phase 3E] Done. Pulse assembled.')
  return { pulse_text, week_label: weekLabel }
}

// ─── Phase 3 Orchestrator ─────────────────────────────────────────────────────

/**
 * Runs all Phase 3 sub-phases in order.
 *
 * @param {object[]} cleanReviews - Output of Phase 2
 * @returns {Promise<{ pulse_text: string, week_label: string }>}
 */
export async function analyseAndWritePulse(cleanReviews) {
  // Add a small delay between the two Groq calls to stay within rate limits
  const { themedReviews, themeGroups } = await clusterThemes(cleanReviews)
  await new Promise(r => setTimeout(r, 3000))
  const topThemes   = rankThemes(themeGroups)
  const quotes      = selectQuotes(topThemes)
  const actionIdeas = await generateActionIdeas(topThemes, quotes)
  return assemblePulse(themedReviews, topThemes, quotes, actionIdeas)
}
