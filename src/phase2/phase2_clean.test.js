// src/phase2/phase2_clean.test.js
// Unit tests for Phase 2 — covers all checks from eval.md
// Run with: node src/phase2/phase2_clean.test.js

import assert from 'assert'
import { stripEmojis, isEnglish, truncateAtWord, sanitiseRating, cleanReviews } from './phase2_clean.js'

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

// Helper — makes a minimal review object
function makeReview(text, rating = 4, id = null) {
  return { id: id ?? text.slice(0, 8).replace(/\s/g,'_'), store: 'play_store', rating, title: null, text, date: '2025-04-01', theme: null }
}

// ─── Check 2.1 — Emoji stripping ─────────────────────────────────────────────
console.log('\n[Check 2.1] Emoji stripping')
test('common emojis are removed', () => {
  assert.strictEqual(stripEmojis('great app 😍🔥'), 'great app')
})
test('star emojis are removed', () => {
  assert.strictEqual(stripEmojis('⭐⭐⭐ good enough'), 'good enough')
})
test('skin tone modifier emojis are removed', () => {
  assert(!(/[\u{1F300}-\u{1FFFF}]/u.test(stripEmojis('works fine 🙏🏽'))))
})
test('text with no emojis is unchanged', () => {
  assert.strictEqual(stripEmojis('no emoji here at all'), 'no emoji here at all')
})
test('null input returns null', () => {
  assert.strictEqual(stripEmojis(null), null)
})
test('undefined input returns null', () => {
  assert.strictEqual(stripEmojis(undefined), null)
})
test('emoji-only string becomes empty string', () => {
  assert.strictEqual(stripEmojis('😍🔥💔'), '')
})

// ─── Check 2.2 — English filter ──────────────────────────────────────────────
console.log('\n[Check 2.2] English filter')
test('clear English text is kept', () => {
  assert.strictEqual(isEnglish('the app keeps crashing on my phone'), true)
})
test('Hindi romanised text is dropped', () => {
  assert.strictEqual(isEnglish('bahut achha app hai lekin kyc nahi ho raha'), false)
})
test('Hindi script is dropped', () => {
  assert.strictEqual(isEnglish('यह ऐप बहुत अच्छा है'), false)
})
test('Portuguese is dropped', () => {
  assert.strictEqual(isEnglish('muito bom aplicativo para investimentos'), false)
})
test('very short text (< 20 chars) is kept regardless', () => {
  assert.strictEqual(isEnglish('ok'), true)
})
test('empty string returns false', () => {
  assert.strictEqual(isEnglish(''), false)
})

// ─── Check 2.3 — Word count filter ───────────────────────────────────────────
console.log('\n[Check 2.3] Word count filter (≥7 words)')
test('6-word review is dropped', () => {
  try { cleanReviews([makeReview('this app is very bad now')]) }
  catch (e) { return } // expected — all filtered out throws
  assert.fail('Should have thrown or returned empty')
})
test('7-word review is kept', () => {
  const result = cleanReviews([makeReview('this app is very very bad indeed')])
  assert.strictEqual(result.length, 1)
})
test('single word review is dropped', () => {
  try { cleanReviews([makeReview('bad')]) }
  catch (e) { return }
  assert.fail('Should have thrown')
})

// ─── Check 2.4 — Deduplication on normalised text ────────────────────────────
console.log('\n[Check 2.4] Deduplication on normalised text')
test('case-variant duplicates are removed', () => {
  const reviews = [
    makeReview('The App Is Great And Works Well Today', 5, 'r1'),
    makeReview('the app is great and works well today', 4, 'r2'),
    makeReview('the app is great and works well today ', 3, 'r3'),
  ]
  const result = cleanReviews(reviews)
  assert.strictEqual(result.length, 1)
})

// ─── Check 2.5 — Truncation at word boundary ─────────────────────────────────
console.log('\n[Check 2.5] Truncation')
test('text over 300 chars is truncated and ends with ellipsis', () => {
  const long = 'word '.repeat(70)  // 350 chars
  const result = truncateAtWord(long, 300)
  assert(result.length <= 301, `Length ${result.length} exceeds 301`)
  assert(result.endsWith('…'))
})
test('text exactly 300 chars is not truncated', () => {
  const exact = 'a'.repeat(300)
  assert.strictEqual(truncateAtWord(exact, 300), exact)
})
test('text exactly 301 chars is truncated', () => {
  const over = 'a'.repeat(301)
  const result = truncateAtWord(over, 300)
  assert(result.endsWith('…'))
  assert(result.length <= 301)
})
test('truncation does not cut mid-word', () => {
  const text = 'hello world this is a test sentence that goes on and on '.repeat(6)
  const result = truncateAtWord(text, 300)
  // The character just before '…' should not be a letter in the middle of a word
  const beforeEllipsis = result.slice(0, -1)
  assert(!beforeEllipsis.endsWith('hel') && !beforeEllipsis.endsWith('wor'))
})

// ─── Check 2.6 — Rating sanity ───────────────────────────────────────────────
console.log('\n[Check 2.6] Rating sanity')
test('valid rating 3 is preserved', () => { assert.strictEqual(sanitiseRating(3), 3) })
test('rating 0 becomes null', () => { assert.strictEqual(sanitiseRating(0), null) })
test('rating 6 becomes null', () => { assert.strictEqual(sanitiseRating(6), null) })
test('string rating becomes null', () => { assert.strictEqual(sanitiseRating('4'), null) })
test('null rating stays null', () => { assert.strictEqual(sanitiseRating(null), null) })
test('undefined rating becomes null', () => { assert.strictEqual(sanitiseRating(undefined), null) })

// ─── Check 2.7 — Filter order: emoji strip before language detection ──────────
console.log('\n[Check 2.7] Filter order — emoji-only review is dropped')
test('emoji-only review is dropped after stripping', () => {
  try { cleanReviews([makeReview('😍🔥💔⭐🙏', 4, 'emoji_only')]) }
  catch (e) { return } // expected — stripped to empty → filtered out
  assert.fail('Should have thrown')
})

// Emoji test regex for schema check — declared before use
const EMOJI_REGEX_TEST = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}]/u

// ─── Check 2.8 — Output schema integrity ─────────────────────────────────────
console.log('\n[Check 2.8] Output schema integrity')
test('surviving reviews conform to Data Contract', () => {
  const samples = [
    makeReview('the kyc process is completely broken and stuck for days', 1),
    makeReview('payment failed three times and money was deducted from account', 2),
    makeReview('app crashes every time i open the mutual funds section today', 1),
  ]
  const result = cleanReviews(samples)
  for (const r of result) {
    assert(typeof r.id === 'string', 'id must be string')
    assert.strictEqual(r.store, 'play_store')
    assert.strictEqual(r.theme, null)
    assert(typeof r.text === 'string', 'text must be string')
    assert(r.text.length >= 1, 'text must not be empty')
    assert(r.text.length <= 301, `text too long: ${r.text.length}`)
    assert.strictEqual(r.text, r.text.toLowerCase(), 'text must be lowercase')
    assert(!EMOJI_REGEX_TEST.test(r.text), 'text must not contain emojis')
  }
})

// Emoji test regex for schema check — declared before use (already declared above)

// ─── Edge cases ───────────────────────────────────────────────────────────────
console.log('\n[Edge cases]')
test('whitespace-only review is dropped', () => {
  try { cleanReviews([makeReview('   \n\t  ', 3, 'ws_only')]) }
  catch (e) { return }
  assert.fail('Should have thrown')
})
test('review title null is handled without throwing', () => {
  const r = makeReview('the app is great and works well today', 4)
  r.title = null
  const result = cleanReviews([r])
  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0].title, null)
})
test('all non-English reviews throw a clear error', () => {
  const nonEng = [makeReview('यह ऐप बहुत अच्छा है और काम करता है', 4, 'hindi1')]
  try {
    cleanReviews(nonEng)
    assert.fail('Should have thrown')
  } catch (err) {
    assert(err.message.includes('filtered out'), `Wrong error: ${err.message}`)
  }
})

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`)
console.log(`Phase 2 unit tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('SOME TESTS FAILED — fix before proceeding to Phase 3')
  process.exit(1)
} else {
  console.log('All Phase 2 unit tests passed ✓')
}
