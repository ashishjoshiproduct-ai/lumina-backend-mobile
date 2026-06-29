# Architecture & System Design

This document explains how Lumina is built and **why** each major decision was made. It's written to be read by someone evaluating the engineering and product thinking behind the project, not just the code.

---

## 1. The problem the architecture has to solve

Lumina has three jobs that pull in different directions:

1. **Be fast and simple for a reader** — tap a sentence, get an answer, no friction.
2. **Be safe to put in front of strangers** — no leaked secrets, no runaway costs, no abuse.
3. **Be observable** — the developer needs to know how much it's actually being used.

A naive version (app calls Gemini directly) nails #1 and fails #2 and #3 completely. Most of the interesting design work is in satisfying all three at once.

---

## 2. High-level system

```
┌──────────────────┐        HTTPS         ┌──────────────────────┐        HTTPS        ┌─────────────┐
│  Mobile app      │  ───────────────────▶│  Backend proxy       │ ──────────────────▶ │  Gemini API │
│  (React Native / │   POST /api/ask      │  (Node.js / Express  │   x-goog-api-key    │  (Google)   │
│   Expo)          │◀─────────────────────│   on Render)         │◀─────────────────── │             │
│                  │   { answer }         │                      │   { answer }        │             │
└──────────────────┘                      └──────────────────────┘                     └─────────────┘
```

Three tiers, each with one clear responsibility:

| Tier | Responsibility | Explicitly NOT responsible for |
|------|----------------|-------------------------------|
| **Mobile app** | Rendering the book, capturing the question, displaying the answer | Holding secrets, talking to Gemini, enforcing limits |
| **Backend proxy** | Auth to Gemini, logging, rate limiting, prompt construction | Rendering, storing books |
| **Gemini** | Generating the answer | Everything else |

---

## 3. The central decision: a backend proxy

### Why not call Gemini directly from the app?

It's tempting — one fewer moving part, no hosting to manage. It's also wrong for anything beyond a personal toy, for three reasons:

**Secret exposure.** Any key shipped inside an app can be extracted from the bundle. This isn't theoretical: during development, a key briefly committed to a public GitHub repo was automatically detected and revoked by Google's credential scanning within hours. A shipped app with an embedded key is the same leak, permanently, on every user's device.

**No cost control.** With a direct-call model, every user shares (and can drain) the developer's quota. There's no way to say "20 questions per user per day."

**No visibility.** The developer can't see usage. The original motivating question for this whole piece of work was literally *"how many requests am I actually making?"* — unanswerable without a server in the middle.

### What the proxy buys

By inserting a backend the developer controls:

- The **API key lives only on the server**, as an environment variable. It is never in the app bundle, never in the repo.
- Every request is **logged** (timestamp, latency, story, success/failure).
- Requests are **rate-limited per user** before they ever reach Gemini.
- The **prompt is constructed server-side**, so prompt changes ship without an app update.

This is the single most important architectural choice in the project, and it's the dividing line between "demo" and "product."

---

## 4. Component deep-dives

### 4.1 Mobile app (React Native / Expo)

**Why Expo:** cross-platform (one codebase → iOS + Android) without needing a Mac for the dev loop, and Expo Go lets you test on a real phone by scanning a QR code. SDK 54 was chosen to match the Expo Go version on the test device.

**Reading model:** the book ships *inside* the app as structured data (`book.js`), split into its twelve stories. No network needed to read — only to ask. This makes reading instant and offline-capable; the network is reserved for the one thing that needs it.

**The interaction design problem:** the obvious "select text like on the web" gesture (native long-press selection) proved unreliable inside a scrolling view — selection competed with scroll, and on large text blocks it silently failed. Rather than fight the platform, the interaction was redesigned: each paragraph is split into **sentences**, each sentence is independently tappable, and a **tap** (which cleanly cancels on scroll) selects one sentence and surfaces a small Ask/Copy popup anchored to the tap location. This sidestepped the platform limitation and produced a cleaner UX than the original copy-paste flow.

**Spoiler-scoping on the client:** the app tells the backend which story the reader is in, so the prompt can be constrained to that story.

### 4.2 Backend proxy (Node.js / Express on Render)

**Endpoints:**
- `POST /api/ask` — the main path: validate → rate-limit → build prompt → call Gemini → log → return answer.
- `GET /api/logs` — a usage dashboard returning request counts (last hour / last day), success rates, average latency, and most-read stories.
- `GET /health` — liveness check.

**Auth to Gemini:** the proxy sends the key via the `x-goog-api-key` request header rather than a URL query parameter. (This matters: the newer Gemini "auth" keys are rejected when passed as a URL `?key=` param — a real bug hit during development and fixed by moving to the header.)

**Rate limiting:** an in-memory sliding window per client IP (max N requests per 60s). Simple, no dependencies, good enough for the current scale.

**Logging:** in-memory ring buffer of the most recent requests, with derived stats computed on read. Deliberately simple.

**Prompt construction:** the system prompt enforces the product's voice — answers in 2–4 sentences, plain definitions for archaic words, spoiler refusal ("That would spoil it — keep reading!"), and a ban on long essays. Keeping this server-side means the product's "personality" can be tuned without shipping a new app build.

### 4.3 The web prototype (earlier phase, in `/web`)

Before the mobile app, Lumina was a browser app. Its most technically interesting piece was **client-side PDF parsing**:

- `pdf.js` extracts positioned text fragments from a PDF.
- A custom layer groups fragments into lines, detects **two-column layouts** (standard in research papers), and reads the left column fully before the right — fixing the classic failure where naive extraction interleaves columns into nonsense.
- Heading detection (by relative font size) chunks the document into sections.
- `localStorage` persists reading progress per document.

This phase is preserved because the PDF-extraction work is the foundation of the project's eventual defensible direction (see §6).

---

## 5. Key trade-offs and their costs

| Decision | Benefit | Accepted cost |
|----------|---------|---------------|
| Backend proxy | Secret safety, logging, rate limiting | Hosting to manage; a network hop of latency; free-tier cold starts (~30–60s after idle) |
| Bundle the book in the app | Instant, offline reading | App ships larger; adding books needs an app update |
| In-memory logs | Zero infra, trivial to build | **Logs reset on restart/redeploy** — fine for spot-checks, not long-term analytics |
| In-memory rate limiting | No database | Resets on restart; not shared across multiple server instances |
| Tap-a-sentence instead of free selection | Reliable across platforms; cleaner UX | Sentence-level granularity, not arbitrary spans |
| Gemini Flash | Fast, cheap, good enough for short answers | Not the most capable model for deep analysis |

The recurring theme: **deliberately choosing the simplest thing that's good enough at the current scale**, while knowing exactly what would need to change to scale up (a real datastore for logs and rate limits being the obvious first upgrade).

---

## 6. Where this goes next (and why)

Mid-development, the major reading platforms (Amazon Kindle's "Ask this Book," Google Play Books' "Book Insights") shipped near-identical tap-to-ask features — running on the same underlying model. That makes the generic version of Lumina non-viable: you can't beat the incumbents at a feature they ship for free inside the app where users already keep their library.

The architecture is, however, well-positioned for the **defensible** direction: those incumbents can only operate on books *in their own catalog*. They structurally cannot help with the messy, non-catalog reading that students and professionals actually do — course-reader PDFs, scanned chapters, journal articles, handouts. The web prototype's PDF-extraction engine is exactly the capability needed to serve that gap. The roadmap therefore points at **PDF upload for a specific underserved segment**, not at competing on mainstream books.

This is the part of the project that's as much product strategy as engineering: the technical foundation and the market wedge point at the same place.

---

## 7. One-paragraph summary (for an interview)

> Lumina is a three-tier AI reading app: a React Native client that renders a book and captures questions, a Node/Express proxy on Render that holds the Gemini key, logs usage, and rate-limits, and the Gemini API itself. The defining decision was refusing to embed the API key in the client — everything good about the system (secret safety, cost control, observability) follows from putting a controlled backend in the middle. The hardest engineering was two-column PDF extraction; the hardest product moment was the incumbents shipping the same feature mid-build, which redirected the strategy toward the non-catalog reading they structurally can't serve.
