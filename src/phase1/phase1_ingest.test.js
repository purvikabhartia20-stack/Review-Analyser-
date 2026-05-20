// src/phase1/phase1_ingest.test.js
// Unit tests for Phase 1 — covers all checks from eval.md
// Run with: node src/phase1/phase1_ingest.test.js

import assert from 'assert'
import { makeId, mapReview, deduplicateById } from './phase1_ingest.js'

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

// ─── Check 1.1 — PII stripping ────────────────────────────────────────────────
console.log('\n[Check 1.1] PII stripping')
test('userName is not present on mapped review', () => {
  const raw = { id: 'r1', score: 3, title: 'ok', text: 'works fine', date: new Date('2025-04-01'), userName: 'john_doe', userImage: 'https://img', url: 'https://play.google.com' }
  const result = mapReview(raw)
  assert(!('userName'  in result), 'userName must not exist')
  assert(!('userImage' in result), 'userImage must not exist')
  assert(!('url'       in result), 'url must not exist')
})

test('store is always play_store', () => {
  const result = mapReview({ id: 'r1', score: 3, text: 'ok', date: new Date() })
  assert.strictEqual(result.store, 'play_store')
})

test('theme is always null on ingestion', () => {
  const result = mapReview({ id: 'r1', score: 3, text: 'ok', date: new Date() })
  assert.strictEqual(result.theme, null)
})

// ─── Check 1.2 — ID fallback ──────────────────────────────────────────────────
console.log('\n[Check 1.2] ID fallback')
test('makeId returns a 12-char string', () => {
  const id = makeId('some text', '2025-04-01')
  assert.strictEqual(typeof id, 'string')
  assert.strictEqual(id.length, 12)
})

test('mapReview uses makeId when raw.id is missing', () => {
  const result = mapReview({ score: 4, text: 'good app', date: new Date('2025-04-01') })
  assert.strictEqual(typeof result.id, 'string')
  assert.strictEqual(result.id.length, 12)
})

test('makeId is stable — same inputs produce same output', () => {
  assert.strictEqual(makeId('hello', '2025-01-01'), makeId('hello', '2025-01-01'))
})

// ─── Check 1.3 — Date normalisation ──────────────────────────────────────────
console.log('\n[Check 1.3] Date normalisation')
test('Date object is normalised to YYYY-MM-DD', () => {
  const result = mapReview({ id: 'r1', score: 4, text: 'good', date: new Date('2025-04-15T10:30:00Z') })
  assert.strictEqual(result.date, '2025-04-15')
})

test('ISO string date is normalised to YYYY-MM-DD', () => {
  const result = mapReview({ id: 'r2', score: 4, text: 'good', date: '2025-04-15T10:30:00Z' })
  assert.strictEqual(result.date, '2025-04-15')
})

test('null date falls back to today without throwing', () => {
  const today = new Date().toISOString().split('T')[0]
  const result = mapReview({ id: 'r3', score: 4, text: 'good', date: null })
  assert.strictEqual(result.date, today)
})

// ─── Check 1.4 — Deduplication ────────────────────────────────────────────────
console.log('\n[Check 1.4] Deduplication by ID')
test('duplicate IDs are removed — first occurrence kept', () => {
  const reviews = [
    { id: 'dup', store: 'play_store', rating: 4, title: null, text: 'first', date: '2025-01-01', theme: null },
    { id: 'dup', store: 'play_store', rating: 3, title: null, text: 'second', date: '2025-01-01', theme: null }
  ]
  const result = deduplicateById(reviews)
  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0].text, 'first')
})

test('unique IDs all survive deduplication', () => {
  const reviews = [
    { id: 'a', store: 'play_store', rating: 4, title: null, text: 'one', date: '2025-01-01', theme: null },
    { id: 'b', store: 'play_store', rating: 3, title: null, text: 'two', date: '2025-01-01', theme: null },
    { id: 'c', store: 'play_store', rating: 5, title: null, text: 'three', date: '2025-01-01', theme: null }
  ]
  const result = deduplicateById(reviews)
  assert.strictEqual(result.length, 3)
})

// ─── Check 1.5 — Hard cap at 150 ─────────────────────────────────────────────
console.log('\n[Check 1.5] Hard cap at 150')
test('deduplicateById caps output at 150 reviews', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: `r${i}`, store: 'play_store', rating: 4, title: null,
    text: `review ${i}`, date: '2025-01-01', theme: null
  }))
  const result = deduplicateById(many)
  assert(result.length <= 150, `Expected ≤150 but got ${result.length}`)
})

// ─── Check 1.7 — Rating validation ───────────────────────────────────────────
console.log('\n[Check 1.7] Rating validation')
test('valid ratings 1–5 are preserved', () => {
  for (const score of [1, 2, 3, 4, 5]) {
    const result = mapReview({ id: 'r', score, text: 'ok', date: new Date() })
    assert.strictEqual(result.rating, score)
  }
})

test('score 0 maps to null', () => {
  const result = mapReview({ id: 'r', score: 0, text: 'ok', date: new Date() })
  assert.strictEqual(result.rating, null)
})

test('score 6 maps to null', () => {
  const result = mapReview({ id: 'r', score: 6, text: 'ok', date: new Date() })
  assert.strictEqual(result.rating, null)
})

test('missing score maps to null', () => {
  const result = mapReview({ id: 'r', text: 'ok', date: new Date() })
  assert.strictEqual(result.rating, null)
})

// ─── Edge cases ───────────────────────────────────────────────────────────────
console.log('\n[Edge cases]')
test('undefined text maps to empty string', () => {
  const result = mapReview({ id: 'r', score: 3, date: new Date() })
  assert.strictEqual(result.text, '')
})

test('undefined title maps to null', () => {
  const result = mapReview({ id: 'r', score: 3, text: 'ok', date: new Date() })
  assert.strictEqual(result.title, null)
})

test('Data Contract fields are all present', () => {
  const result = mapReview({ id: 'r1', score: 4, title: 'good', text: 'works well', date: new Date() })
  const required = ['id', 'store', 'rating', 'title', 'text', 'date', 'theme']
  for (const field of required) {
    assert(field in result, `Missing field: ${field}`)
  }
})

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`)
console.log(`Phase 1 unit tests: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('SOME TESTS FAILED — fix before proceeding to Phase 2')
  process.exit(1)
} else {
  console.log('All Phase 1 unit tests passed ✓')
}
