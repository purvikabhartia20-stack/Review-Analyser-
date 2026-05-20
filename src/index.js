// src/index.js
// Pipeline orchestrator — runs all 4 phases in sequence.

import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'fs'
import { ingestReviews }          from './phase1/phase1_ingest.js'
import { cleanReviews }           from './phase2/phase2_clean.js'
import { analyseAndWritePulse }   from './phase3/phase3_analyse.js'
import { createGoogleDoc, sendEmail } from './phase4/phase4_deliver.js'

async function run() {
  console.log('=== Groww Review Analyser — Starting ===\n')

  // ── Phase 1 ──────────────────────────────────────────────────────────────
  const rawReviews = await ingestReviews()
  mkdirSync('data', { recursive: true })
  writeFileSync('data/raw_reviews.json', JSON.stringify(rawReviews, null, 2))
  console.log(`Saved ${rawReviews.length} raw reviews to data/raw_reviews.json\n`)

  // ── Phase 2 ──────────────────────────────────────────────────────────────
  const cleanedReviews = cleanReviews(rawReviews)
  console.log()

  // ── Phase 3 ──────────────────────────────────────────────────────────────
  const { pulse_text, week_label } = await analyseAndWritePulse(cleanedReviews)
  mkdirSync('output', { recursive: true })
  const outFile = `output/pulse_${new Date().toISOString().split('T')[0]}.txt`
  writeFileSync(outFile, pulse_text)
  console.log(`\nPulse saved locally to ${outFile}\n`)
  console.log('─── PULSE PREVIEW ───')
  console.log(pulse_text)
  console.log('─────────────────────\n')

  // ── Phase 4 ──────────────────────────────────────────────────────────────
  console.log('[Phase 4] Starting delivery...')
  
  // Create Google Doc
  const docUrl = await createGoogleDoc(pulse_text, week_label)
  
  // Send Email
  await sendEmail(pulse_text, week_label, docUrl)

  console.log('\n=== Pipeline complete. ===')
}

run().catch(err => {
  console.error('\n[FATAL]', err.message)
  process.exit(1)
})
