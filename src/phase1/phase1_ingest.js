// src/phase1/phase1_ingest.js
// Phase 1 — Ingest Reviews
// Fetches the 150 most recent public Groww Play Store reviews,
// maps them to the Data Contract schema, strips all PII, and returns a clean array.

import gplay from 'google-play-scraper'
import crypto from 'crypto'

// ─── Constants ────────────────────────────────────────────────────────────────
const APP_ID      = 'com.nextbillion.groww'
const MAX_REVIEWS = 150
const RETRY_LIMIT = 3
const RETRY_DELAY = 2000 // ms

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a stable 12-char ID from text + date string.
 * Used when the scraper returns no native review ID.
 */
export function makeId(text, date) {
  return crypto
    .createHash('sha1')
    .update(String(text ?? '') + String(date ?? ''))
    .digest('hex')
    .slice(0, 12)
}

/**
 * Maps a single raw scraper result to the shared Data Contract schema.
 * Deliberately omits all PII fields: userName, userImage, url, replyDate, replyText.
 *
 * @param {object} raw - Raw review object from google-play-scraper
 * @returns {object} Review conforming to Data Contract
 */
export function mapReview(raw) {
  // Normalise date to YYYY-MM-DD regardless of whether it arrives as a Date or string
  let date
  if (raw.date instanceof Date) {
    date = raw.date.toISOString().split('T')[0]
  } else if (raw.date) {
    date = String(raw.date).split('T')[0]
  } else {
    // Fallback: use today's date — do not throw
    date = new Date().toISOString().split('T')[0]
  }

  const text  = raw.text  ?? ''
  const score = raw.score ?? null

  return {
    id:     raw.id ?? makeId(text, date),
    store:  'play_store',
    rating: (typeof score === 'number' && score >= 1 && score <= 5) ? score : null,
    title:  raw.title ?? null,
    text,
    date,
    theme:  null
    // userName, userImage, url, replyDate, replyText — intentionally omitted
  }
}

/**
 * Deduplicates an array of mapped reviews by their `id` field.
 * Keeps the first occurrence of each ID.
 *
 * @param {object[]} reviews
 * @returns {object[]}
 */
export function deduplicateById(reviews) {
  const seen = new Set()
  const out  = []
  for (const r of reviews) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      out.push(r)
    }
    if (out.length >= MAX_REVIEWS) break
  }
  return out
}

// ─── Phase 1 Entry Point ──────────────────────────────────────────────────────

/**
 * Phase 1 entry point.
 * Fetches Play Store reviews, maps to Data Contract, strips PII, deduplicates.
 *
 * @returns {Promise<object[]>} raw_reviews — ≤150 Review objects, PII-free
 */
export async function ingestReviews() {
  console.log('[Phase 1] Fetching Play Store reviews...')

  let result
  let attempts = 0

  // Retry loop — up to RETRY_LIMIT attempts with exponential-ish backoff
  while (attempts < RETRY_LIMIT) {
    try {
      result = await gplay.reviews({
        appId:    APP_ID,
        lang:     'en',
        country:  'in',
        sort:     gplay.sort.NEWEST,
        num:      MAX_REVIEWS,
        throttle: 10
      })
      break // success — exit retry loop
    } catch (err) {
      attempts++
      if (attempts >= RETRY_LIMIT) {
        throw new Error(
          `[Phase 1] Fetch failed after ${RETRY_LIMIT} attempts: ${err.message}`
        )
      }
      console.warn(
        `[Phase 1] Fetch attempt ${attempts} failed (${err.message}). Retrying in ${RETRY_DELAY / 1000}s...`
      )
      await new Promise(r => setTimeout(r, RETRY_DELAY))
    }
  }

  // google-play-scraper returns either { data: [...] } or the array directly
  const rawArray = Array.isArray(result?.data) ? result.data
                 : Array.isArray(result)        ? result
                 : []

  if (rawArray.length === 0) {
    throw new Error(
      '[Phase 1] No reviews returned — check app ID and network connection.'
    )
  }

  // Map each raw item to the Data Contract schema
  const mapped = rawArray.map((item, idx) => {
    try {
      return mapReview(item)
    } catch (err) {
      console.warn(`[Phase 1] Skipping malformed record at index ${idx}: ${err.message}`)
      return null
    }
  }).filter(Boolean) // drop any nulls from malformed records

  // Deduplicate by id and enforce MAX_REVIEWS cap
  const reviews = deduplicateById(mapped)

  if (reviews.length === 0) {
    throw new Error(
      '[Phase 1] No reviews returned — check app ID and network connection.'
    )
  }

  if (reviews.length < 10) {
    console.warn(
      `[Phase 1] Warning: only ${reviews.length} reviews fetched. Sample is small.`
    )
  }

  console.log(`[Phase 1] Done. ${reviews.length} reviews ingested.`)
  return reviews
}
