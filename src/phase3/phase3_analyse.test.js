// src/phase3/phase3_analyse.test.js
// Unit tests for Phase 3 (pure functions only — no real Groq calls)
// Run with: node src/phase3/phase3_analyse.test.js

import assert from 'assert'
import { stripFences, rankThemes, selectQuotes, assemblePulse } from './phase3_analyse.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    → ${err.message}`)
    failed++
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeReview(id, text, rating = 3) {
  return { id, store: 'play_store', rating, title: null, text, date: '2025-04-01', theme: null }
}

function makeTheme(name, count, avgRating = 2) {
  return {
    theme: name,
    review_count: count,
    avg_rating: avgRating,
    low_rating_pct: 60,
    reviews: Array.from({ length: count }, (_, i) =>
      makeReview(`${name}_r${i}`, `review text for ${name} issue number ${i} in the app`, avgRating)
    )
  }
}

// ─── Check 3A.2 — Fence stripping ────────────────────────────────────────────
console.log('\n[Check 3A.2] Markdown fence stripping')
test('strips ```json fence', () => {
  const fenced = '```json\n[{"theme":"KYC","review_ids":["r1"]}]\n```'
  const result = stripFences(fenced)
  assert.doesNotThrow(() => JSON.parse(result))
  assert.strictEqual(JSON.parse(result)[0].theme, 'KYC')
})
test('strips plain ``` fence', () => {
  const fenced = '```\n[{"theme":"Pay","review_ids":["r2"]}]\n```'
  const result = stripFences(fenced)
  assert.doesNotThrow(() => JSON.parse(result))
})
test('leaves clean JSON untouched', () => {
  const clean = '[{"theme":"A","review_ids":["r1"]}]'
  assert.strictEqual(stripFences(clean), clean)
})

// ─── Check 3B.1 — Sorted by review count ─────────────────────────────────────
console.log('\n[Check 3B.1] Ranking by review count')
test('themes sorted descending by review count', () => {
  const groups = [
    { theme: 'A', reviews: Array(10).fill({}) },
    { theme: 'B', reviews: Array(30).fill({}) },
    { theme: 'C', reviews: Array(20).fill({}) },
  ]
  const top = rankThemes(groups)
  assert.strictEqual(top[0].theme, 'B')
  assert.strictEqual(top[1].theme, 'C')
  assert.strictEqual(top[2].theme, 'A')
})
test('returns at most 3 themes', () => {
  const groups = Array.from({ length: 5 }, (_, i) => ({
    theme: `T${i}`, reviews: Array(10 - i).fill({})
  }))
  assert(rankThemes(groups).length <= 3)
})
test('works with only 2 theme groups', () => {
  const groups = [
    { theme: 'A', reviews: Array(10).fill({}) },
    { theme: 'B', reviews: Array(5).fill({}) },
  ]
  assert.strictEqual(rankThemes(groups).length, 2)
})

// ─── Check 3B.2/3/4 — Stats computation ──────────────────────────────────────
console.log('\n[Check 3B.2-4] Stats computation')
test('avg_rating computed correctly', () => {
  const groups = [{ theme: 'X', reviews: [
    { rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: null }
  ]}]
  const top = rankThemes(groups)
  assert.strictEqual(top[0].avg_rating, 2.0)
})
test('low_rating_pct computed correctly', () => {
  const groups = [{ theme: 'X', reviews: [
    { rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: 4 }, { rating: 5 }
  ]}]
  assert.strictEqual(rankThemes(groups)[0].low_rating_pct, 40)
})
test('all null ratings produce null stats', () => {
  const groups = [{ theme: 'X', reviews: [{ rating: null }, { rating: null }] }]
  const top = rankThemes(groups)
  assert.strictEqual(top[0].avg_rating, null)
  assert.strictEqual(top[0].low_rating_pct, null)
})
test('avg_rating rounds to 1 decimal', () => {
  const groups = [{ theme: 'X', reviews: [{ rating: 1 }, { rating: 2 }, { rating: 2 }] }]
  const top = rankThemes(groups)
  assert.strictEqual(top[0].avg_rating, 1.7)
})

// ─── Check 3C.1 — Quote prefers low-rated ────────────────────────────────────
console.log('\n[Check 3C.1] Quote selection')
test('prefers low-rated review as quote', () => {
  const theme = makeTheme('KYC', 3)
  theme.reviews = [
    makeReview('r1', 'great app works perfectly fine for me today', 5),
    makeReview('r2', 'kyc stuck for three days no response at all from support', 1),
    makeReview('r3', 'average experience with the kyc process overall', 3),
  ]
  const quotes = selectQuotes([theme])
  assert(quotes[0].text.includes('kyc stuck'))
})
test('PII email is rejected from quote', () => {
  const theme = makeTheme('Support', 3)
  theme.reviews = [
    makeReview('r1', 'contact me at john@example.com for refund please help', 1),
    makeReview('r2', 'support team never responds to my complaints at all ever', 2),
  ]
  const quotes = selectQuotes([theme])
  assert(!quotes[0].text.includes('@'))
})
test('PII phone number is rejected from quote', () => {
  const theme = makeTheme('Support', 2)
  theme.reviews = [
    makeReview('r1', 'call me at 9876543210 to resolve this issue please', 1),
    makeReview('r2', 'support never responds to any of my tickets at all', 2),
  ]
  const quotes = selectQuotes([theme])
  assert(!/\d{10}/.test(quotes[0].text))
})
test('quote is truncated to 150 chars with ellipsis', () => {
  const theme = makeTheme('Perf', 1)
  theme.reviews = [makeReview('r1', 'a'.repeat(200), 1)]
  const quotes = selectQuotes([theme])
  assert(quotes[0].text.length <= 151)
  assert(quotes[0].text.endsWith('…'))
})
test('selectQuotes returns one quote per theme', () => {
  const themes = [makeTheme('A', 5), makeTheme('B', 4), makeTheme('C', 3)]
  const quotes = selectQuotes(themes)
  assert.strictEqual(quotes.length, 3)
  assert(quotes.every(q => typeof q.theme === 'string'))
  assert(quotes.every(q => typeof q.text === 'string' && q.text.length > 0))
})

// ─── Check 3E — Pulse assembly ───────────────────────────────────────────────
console.log('\n[Check 3E] Pulse assembly')

const sampleReviews = Array.from({ length: 20 }, (_, i) => makeReview(`r${i}`, `review text ${i}`))
const sampleThemes  = [makeTheme('KYC Verification', 8, 1.8), makeTheme('Payment Failures', 6, 2.1), makeTheme('App Performance', 5, 2.4)]
const sampleQuotes  = [
  { theme: 'KYC Verification', text: 'kyc stuck for three days no response at all' },
  { theme: 'Payment Failures',  text: 'payment deducted but not reflected in portfolio' },
  { theme: 'App Performance',   text: 'app crashes every time i open mutual funds tab' },
]
const sampleIdeas = [
  'Add real-time KYC status tracker in the app dashboard.',
  'Implement automatic payment reconciliation for failed transactions.',
  'Fix mutual funds tab crash by profiling memory on low-end devices.',
]

test('pulse contains all required sections', () => {
  const { pulse_text } = assemblePulse(sampleReviews, sampleThemes, sampleQuotes, sampleIdeas)
  assert(pulse_text.includes('GROWW APP — WEEKLY REVIEW PULSE'))
  assert(pulse_text.includes('TOP THEMES THIS WEEK'))
  assert(pulse_text.includes('WHAT USERS ARE SAYING'))
  assert(pulse_text.includes('ACTION IDEAS'))
  assert(pulse_text.includes('Generated by Groww Review Analyser'))
})
test('pulse contains no unfilled placeholders', () => {
  const { pulse_text } = assemblePulse(sampleReviews, sampleThemes, sampleQuotes, sampleIdeas)
  assert(!pulse_text.includes('undefined'), 'Found "undefined" in pulse')
  assert(!pulse_text.includes('<'), 'Found unfilled placeholder in pulse')
})
test('pulse contains no literal null', () => {
  const { pulse_text } = assemblePulse(sampleReviews, sampleThemes, sampleQuotes, sampleIdeas)
  assert(!pulse_text.includes('null'), 'Found "null" in pulse')
})
test('null avg_rating shows N/A not null★', () => {
  const nullThemes = [makeTheme('X', 5, null)]
  nullThemes[0].avg_rating = null
  nullThemes[0].low_rating_pct = null
  const { pulse_text } = assemblePulse(sampleReviews, nullThemes, [sampleQuotes[0]], [sampleIdeas[0]])
  assert(!pulse_text.includes('null★'), 'null★ found in pulse')
  assert(pulse_text.includes('N/A'), 'N/A not found for null rating')
})
test('quotes are wrapped in double quotes in pulse', () => {
  const { pulse_text } = assemblePulse(sampleReviews, sampleThemes, sampleQuotes, sampleIdeas)
  for (const q of sampleQuotes) {
    assert(pulse_text.includes(`"${q.text}"`), `Quote not found: ${q.text}`)
  }
})
test('week_label is returned as a string', () => {
  const { week_label } = assemblePulse(sampleReviews, sampleThemes, sampleQuotes, sampleIdeas)
  assert(typeof week_label === 'string')
  assert(week_label.length > 0)
})
test('review count appears in pulse', () => {
  const { pulse_text } = assemblePulse(sampleReviews, sampleThemes, sampleQuotes, sampleIdeas)
  assert(pulse_text.includes(String(sampleReviews.length)))
})

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`)
console.log(`Phase 3 unit tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('SOME TESTS FAILED — fix before proceeding to Phase 4')
  process.exit(1)
} else {
  console.log('All Phase 3 unit tests passed ✓')
}
