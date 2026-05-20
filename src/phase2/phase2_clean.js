// src/phase2/phase2_clean.js
// Phase 2 — Clean and Filter
// Applies 7 filters in strict order to produce a clean, LLM-ready review list.
// Filter order: deduplicate → strip emojis → English only → ≥7 words → normalise → truncate → rating check

import { franc } from 'franc-min'

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_WORDS = 7
const MAX_CHARS = 300

// Unicode ranges covering all major emoji blocks including misc symbols
const EMOJI_REGEX = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}]/gu

// English stop words used as fallback when franc returns 'und'
const EN_STOPWORDS = ['the','is','are','was','not','app','and','but','for','with','this','have','has','my','it']

// ─── Step helpers (exported for unit testing) ─────────────────────────────────

/**
 * Strips all emoji characters from a string.
 * Returns null if input is null/undefined (preserves null titles).
 *
 * @param {string|null} str
 * @returns {string|null}
 */
export function stripEmojis(str) {
  if (str === null || str === undefined) return null
  return str.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim()
}

/**
 * Returns true if the text is English (or likely English).
 * Uses franc-min for detection with a stop-word fallback.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isEnglish(text) {
  if (!text || text.trim().length === 0) return false
  const lang = franc(text)
  if (lang === 'eng') return true
  // 'und' = undetermined — franc can't detect very short texts
  if (lang === 'und') {
    // Short texts (< 20 chars) are likely English short phrases — keep them
    if (text.length < 20) return true
    // Longer 'und' texts: use stop-word heuristic
    const lower = text.toLowerCase()
    return EN_STOPWORDS.some(w => lower.includes(w))
  }
  return false
}

/**
 * Truncates text to maxChars at the nearest word boundary.
 * Appends '…' if truncated.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function truncateAtWord(text, maxChars) {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…'
}

/**
 * Validates and sanitises a rating value.
 * Returns the integer if valid (1–5), otherwise null.
 *
 * @param {*} rating
 * @returns {number|null}
 */
export function sanitiseRating(rating) {
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) return rating
  return null
}

// ─── Phase 2 Entry Point ──────────────────────────────────────────────────────

/**
 * Phase 2 entry point.
 * Applies all 7 filters in strict order and returns clean reviews.
 *
 * @param {object[]} rawReviews - Output of Phase 1
 * @returns {object[]} clean_reviews — filtered, English-only, emoji-free, ≥7 words, ≤300 chars
 */
export function cleanReviews(rawReviews) {
  console.log(`[Phase 2] Cleaning ${rawReviews.length} reviews...`)

  // ── Step 1: Deduplicate on normalised text ────────────────────────────────
  const seenTexts = new Set()
  let reviews = rawReviews.filter(r => {
    const key = (r.text ?? '').toLowerCase().trim()
    if (seenTexts.has(key)) return false
    seenTexts.add(key)
    return true
  })
  console.log(`[Phase 2] After dedup: ${reviews.length}`)

  // ── Step 2: Strip emojis from text and title ──────────────────────────────
  reviews = reviews.map(r => ({
    ...r,
    text:  stripEmojis(r.text)  ?? '',
    title: stripEmojis(r.title)       // null stays null
  }))

  // ── Step 3: English only ──────────────────────────────────────────────────
  reviews = reviews.filter(r => isEnglish(r.text))
  console.log(`[Phase 2] After English filter: ${reviews.length}`)

  // ── Step 4: Minimum word count (≥7 words) ────────────────────────────────
  reviews = reviews.filter(r => r.text.trim().split(/\s+/).filter(Boolean).length >= MIN_WORDS)
  console.log(`[Phase 2] After word count filter: ${reviews.length}`)

  // ── Step 5: Normalise — lowercase, collapse whitespace ───────────────────
  reviews = reviews.map(r => ({
    ...r,
    text: r.text.toLowerCase().replace(/\s+/g, ' ').trim()
  }))

  // ── Step 6: Truncate to MAX_CHARS ─────────────────────────────────────────
  reviews = reviews.map(r => ({
    ...r,
    text: truncateAtWord(r.text, MAX_CHARS)
  }))

  // ── Step 7: Rating sanity check ───────────────────────────────────────────
  reviews = reviews.map(r => ({
    ...r,
    rating: sanitiseRating(r.rating)
  }))

  // ── Final checks ──────────────────────────────────────────────────────────
  if (reviews.length === 0) {
    throw new Error(
      '[Phase 2] All reviews were filtered out — check language filter or review quality.'
    )
  }

  if (reviews.length < 10) {
    console.warn(`[Phase 2] Warning: only ${reviews.length} reviews survived filtering.`)
  }

  console.log(`[Phase 2] Done. ${reviews.length} clean reviews ready.`)
  return reviews
}
