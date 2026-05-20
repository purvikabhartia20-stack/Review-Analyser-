# Groww Review Analyser — Project Brief

## What We're Building

A weekly intelligence pipeline that turns raw Groww app reviews (App Store + Play Store) into a one-page pulse your team can read in minutes. The system aggregates public reviews, finds patterns, surfaces real user quotes, and delivers the output to two places your stakeholders already live: **Google Docs** and **Gmail**.

---

## The Problem

Groww receives hundreds of reviews every week across both stores. No one has time to read them all. Product, Growth, Support, and Leadership teams are making decisions without a clear, current picture of what users actually think. The signal is there — it's just buried.

---

## The Solution (End-to-End Flow)

```
Public Reviews (App Store + Play Store)
        ↓
  Pull last 8–12 weeks of reviews
        ↓
  Cluster into up to 5 themes
        ↓
  Generate one-page weekly pulse
        ↓
  ┌─────────────────┬──────────────────┐
  │   Google Docs   │      Gmail       │
  │  (pulse lives   │  (draft email    │
  │    here)        │   with link)     │
  └─────────────────┴──────────────────┘
```

---

## What "Done" Looks Like

1. **Reviews pulled** — last 8–12 weeks of public App Store and Play Store reviews for Groww, with fields: rating, title, review text, date.
2. **Themes identified** — reviews clustered into at most 5 themes (e.g. onboarding, KYC, payments, statements, withdrawals).
3. **Pulse generated** — a one-page weekly note containing:
   - Top 3 themes (what users are talking about most)
   - 3 real user quotes (verbatim, anonymised — no usernames or device IDs)
   - 3 action ideas (concrete next steps grounded in the themes)
4. **Google Doc created** — the pulse is written into a Google Doc stakeholders can open and read.
5. **Gmail draft created** — a draft email to yourself (or an alias) containing the pulse or a direct link to the Doc.

---

## Deliverables Breakdown

### Weekly One-Page Pulse
| Section | Details |
|---|---|
| Top Themes | Up to 3 of the 5 clusters, ranked by review volume |
| User Quotes | 3 verbatim snippets, stripped of any PII |
| Action Ideas | 3 concrete next steps tied directly to the themes |

### Integrations
| Surface | How | Why |
|---|---|---|
| Google Docs | Via MCP server | Pulse lives where stakeholders already read |
| Gmail | Via MCP server | One-click draft ready to send |

> **MCP-first rule:** Both integrations use MCP (Model Context Protocol) servers — not hand-rolled OAuth + REST clients. MCP handles auth and HTTP plumbing so we don't have to.

---

## Who This Helps

| Audience | Value |
|---|---|
| **Product / Growth** | Prioritise fixes and improvements from real user signal |
| **Support** | Align messaging with what users are actually saying |
| **Leadership** | One-page health check — no drowning in raw reviews |

---

## Constraints

| Constraint | Rule |
|---|---|
| **Review source** | Public exports only — no scraping behind store logins, no ToS-violating automation |
| **Theme limit** | Maximum 5 clusters; pulse highlights the top 3 |
| **Length** | Pulse note ≤ 250 words — keep it scannable |
| **Privacy** | Zero PII in any output — no usernames, emails, device IDs, or identifiable reviewer data; all quotes are anonymous |

---

## Theme Examples (Pick What Fits)

- Onboarding
- KYC (Know Your Customer verification)
- Payments & Transactions
- Statements & Portfolio View
- Withdrawals & Fund Transfers

These are starting points. The actual themes are derived from what users are saying in the review window, not pre-assigned.

---

## Tech Approach

```
Data Layer      →  Public review exports (CSV / JSON / API within ToS)
Analysis Layer  →  Theme clustering + summarisation (LLM-assisted)
Delivery Layer  →  Google Docs MCP server + Gmail MCP server
```

No bespoke Google API clients. No manual OAuth flows. MCP servers expose the tools; the agent calls them.

---

## Review Data Fields

Whatever the export provides, we work with at minimum:

- `rating` — star rating (1–5)
- `title` — review headline (if available)
- `text` — full review body
- `date` — submission date (for the 8–12 week window filter)

---

## Summary

Pull → Cluster → Summarise → Deliver. Public data in, actionable insight out, zero credential wiring, zero PII leakage. The team gets a weekly pulse in their inbox and a living Doc they can reference any time.
