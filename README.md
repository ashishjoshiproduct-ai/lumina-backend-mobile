# Lumina

**An AI reading companion that helps people understand difficult text — without spoilers.**

Lumina lets a reader tap any sentence in a book and ask an AI about it: what a word means, what's happening, why it matters. The AI only ever sees the text the reader has already passed, so it can answer questions without giving away what's ahead.

Built end to end — product, frontend, backend, deployment — as a solo project to go from idea to a working app on a real phone.

---

## What it does

- **Read** a full book in a clean, distraction-free reader (bundled with *The Adventures of Sherlock Holmes*).
- **Tap a sentence** to select it; a small popup offers **Ask** or **Copy**.
- **Ask the AI** about that sentence — definitions, context, "what does this mean" — and get a short, conversational answer.
- **Stay spoiler-free**: the AI is scoped to the reader's current position in the book and is instructed never to reveal what comes later.

---

## Demo

| Reader | Tap to select | Ask the AI |
|--------|---------------|------------|
| _(add screenshot)_ | _(add screenshot)_ | _(add screenshot)_ |

> Replace these with screenshots or a short screen-recording GIF from your phone. A 20-second clip of tap → Ask → answer is the single most convincing thing you can put here.

---

## Architecture at a glance

```
┌──────────────────┐        HTTPS         ┌──────────────────────┐        HTTPS        ┌─────────────┐
│  Mobile app      │  ───────────────────▶│  Backend proxy       │ ──────────────────▶ │  Gemini API │
│  (React Native / │   POST /api/ask      │  (Node.js / Express  │   x-goog-api-key    │  (Google)   │
│   Expo)          │◀─────────────────────│   on Render)         │◀─────────────────── │             │
│                  │   { answer }         │                      │   { answer }        │             │
└──────────────────┘                      └──────────────────────┘                     └─────────────┘
                                                   │
                                                   ├─ Holds the API key (never in the app)
                                                   ├─ Logs every request (usage analytics)
                                                   └─ Rate-limits per user (abuse / cost control)
```

The key design decision: **the app never holds the API key.** It talks only to a backend the developer controls, which forwards requests to Gemini. This keeps the secret off every user's device, enables usage logging, and allows per-user rate limiting — the difference between a prototype and something you can put in front of real people.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design and the reasoning behind each decision.

---

## Tech stack

**Mobile app**
- React Native via Expo (SDK 54)
- Single-file `App.js` reader with tap-to-select, scoped AI panel, story navigation
- `expo-clipboard` for copy support

**Backend**
- Node.js + Express
- Deployed on Render as a stateless web service
- In-memory request logging + a `/api/logs` usage dashboard
- Per-IP rate limiting

**AI**
- Google Gemini (`gemini-2.5-flash`)
- System prompt enforces brevity, spoiler-safety, and reader-companion tone

**Earlier web prototype** (in [`/web`](./web))
- Vanilla HTML/JS, no framework
- Client-side PDF parsing with `pdf.js`, including **two-column layout detection** for research papers
- `localStorage` reading-progress persistence
- Deployed on GitHub Pages

---

## Repo structure

```
/
├── README.md              ← you are here
├── ARCHITECTURE.md        ← system design + decision log
├── mobile/
│   ├── App.js             ← the React Native reader app
│   ├── book.js            ← bundled book text, split into stories
│   └── package.json
├── backend/
│   ├── index.js           ← Express proxy + logging + rate limiting
│   └── package.json
└── web/
    └── index.html         ← original browser prototype (PDF + Clarify)
```

---

## Running it yourself

**Backend**
```bash
cd backend
npm install
GEMINI_API_KEY=your_key_here npm start
# serves on http://localhost:3000
```

**Mobile app**
```bash
cd mobile
npm install
# set BACKEND_URL in App.js to your backend's URL
npx expo start -c
# scan the QR code with Expo Go on your phone
```

---

## What I learned building this

This started as "add an AI button to a reading app" and turned into a full lesson in shipping a consumer product solo. A few things that were harder or more interesting than expected:

- **PDF text extraction is genuinely hard.** Research papers use two-column layouts; naive top-to-bottom extraction scrambles the columns together. I had to detect column boundaries and read each column in order. This was the single biggest engineering rabbit hole.
- **Mobile text selection is not free.** Native long-press selection was unreliable inside a scroll view, so I redesigned the interaction around tap-to-select-a-sentence — which ended up being a better UX anyway.
- **Secrets leak instantly.** An API key briefly committed to a public repo was auto-detected and disabled by Google within hours. That experience is exactly why the final architecture puts the key behind a backend.
- **The market moved under me.** Mid-build, Amazon and Google both shipped near-identical "ask AI about this book" features. That reframed the product question from "can I build this" to "where can a focused product still win" — pushing toward underserved niches (e.g. students reading messy, non-Kindle PDFs) rather than competing head-on.

---

## Status & roadmap

**Working today:** mobile reader, tap-to-ask, spoiler-scoped AI, secure backend proxy, usage logging, rate limiting.

**Next:**
- PDF upload (the defensible wedge — the reading incumbents can't touch non-catalog files)
- Persistent storage for logs (survives restarts)
- Reading-position memory across sessions
- Customer validation with a specific student segment before further building

---

*Built by Ashish Joshi. Product manager exploring what it takes to ship an AI consumer product hands-on — from problem definition through deployment.*
