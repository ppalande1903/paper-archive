# Paper Archive

**Complex academic papers, retold for everyone.** Upload a PDF and get back a short illustrated reader:
plain-language chapters, an everyday analogy for every idea, a hand-drawn doodle per chapter, a pop quiz,
and a glossary that explains each term *the way that paper uses it*.

The shelf starts empty. Every tape is blank until you record a paper.

## Run it

```bash
cd paper-archive
python3 server.py          # then open http://localhost:8000
```

`server.py` uses only the Python standard library. It serves the site and lets Claude write explainers, and it
only answers requests from this machine. **No API key is needed.**

The site also works with no server at all: host the folder on any static host (GitHub Pages, Netlify, …) and
the in-browser writer does the work. Only the Claude option needs `server.py`.

## Deploy it on Vercel, with Claude for people you approve

A Claude plan is for its owner only, so the deployed site can't run on it. On Vercel, Claude runs through your
own Anthropic API key (billed per use, separately from any plan), and only for people you approve:

1. Visitors click **Ask for access** in the add-paper dialog and leave their name, email and a note.
2. You sign in at **`/admin`**, approve (or deny) them, and send them the personal link it gives you
   (**Copy** or **Email it**).
3. Opening the link unlocks Claude on their device. You can revoke anyone, or give them a new link, at any time.

Spending stays bounded: each person gets `DAILY_LIMIT` papers a day (default 3), one at a time, and Claude stops
for everyone once this month's estimated spend reaches `MONTHLY_BUDGET_USD` (default $20). The admin page shows
the spend, per-person usage and recent papers. With the default model, Claude Sonnet 5, a typical paper costs
roughly $0.20–0.35. The in-browser writer stays free for everyone.

Vercel's free plan sets two limits: a PDF sent to Claude must be under **4.4 MB**, and a run must finish within
**5 minutes** (Claude works at medium effort to fit; a very long paper may not).

**Set it up** (everything here is free except your API credit):

1. Create an API key at [platform.claude.com](https://platform.claude.com) and add credit. A monthly spend limit
   there is a good second safety net.
2. On [vercel.com](https://vercel.com), sign in with GitHub → **Add New… → Project** → import this repo →
   **Deploy**. (It works straight away with the in-browser writer; Claude says it isn't set up yet.)
3. In the project, **Storage → Create Database → Upstash for Redis** (free plan) → connect it to the project.
   That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Settings → Environment Variables**: add `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD` (long and unique) and
   `OWNER_NAME` (your name, shown to visitors). Optional: `DAILY_LIMIT`, `MONTHLY_BUDGET_USD`, `CLAUDE_MODEL`.
5. **Deployments → … → Redeploy** so the new settings apply, then open `https://<your-project>.vercel.app/admin`.

The functions are in [`api/`](api); all the settings are described at the top of [`api/_lib.js`](api/_lib.js).

## Adding a paper

1. Click a blank tape (or **+ Add a paper**) and drop in a PDF.
2. Choose who writes the explainer:
   - **Claude:** locally, runs the Claude Code CLI you're already signed in to, so it counts toward your Claude
     plan like any other chat. The CLI is found on your PATH or inside the Claude Code VS Code extension (set
     `CLAUDE_BIN` to override). On Vercel it's the Claude API, for approved people (see above). Best
     explanations, reads scanned pages, and takes about 1–5 minutes.
   - **In your browser:** pdf.js pulls out the text and a small open model (Qwen3.5 2B or 4B, via
     [WebLLM](https://github.com/mlc-ai/web-llm)) writes the explainer on the device's graphics chip. Free and
     private: the paper never leaves the device. The model downloads once (about 1.1 GB for 2B) and is cached by
     the browser. Needs WebGPU (recent Chrome or Edge on a laptop or desktop). The explainer is deliberately short
     (3–4 chapters, 6–10 glossary cards, a 3-question quiz, built-in doodles) because a small model writes slowly:
     on an 8 GB M2 it takes around 10 minutes. Scanned PDFs don't work, and papers over roughly 16k tokens of
     text are refused rather than cut off (the reference list is skipped, so most papers fit).
3. When it's ready you're asked **whether to keep it on this device**:
   - **Yes:** saved in this browser (IndexedDB) until you remove it.
   - **No:** kept only for this session and gone when the tab closes.

You can change your mind later from the shelf or the reader ("Keep it" / "Don't keep" / "Remove"). The
**On this device** panel lists everything stored. The PDF itself is never kept: the in-browser writer reads it
in memory, and the server reads it from a temporary folder that's deleted when the job ends.

### Safety

- The Claude run is locked down: `--tools Read --restricted --strict-mcp-config`, in a throwaway folder that only
  holds the PDF, so text inside a paper can't make it run commands or touch other files.
- Everything the model writes is treated as untrusted: text is HTML-escaped (only `**bold**`, `*italic*` and
  `{{term|id}}` links render) and doodles go through an allow-list SVG sanitiser (`PA.safeSVG`).
- The API only accepts requests carrying the site's own header, so other websites can't use it; locally it also
  only answers `localhost`.
- On Vercel: the API key stays in the functions; access links and admin sessions are random, and only their
  hashes are stored; cookies are `HttpOnly` (the admin one `SameSite=Strict`); access requests and admin sign-ins
  are rate-limited; if a visitor leaves mid-run, Claude is stopped so the rest isn't billed.

## What's on each paper page

| Piece | What it does |
|---|---|
| **Chapters** | One per section of the original, in plain words, with key terms underlined. |
| **Analogy notes** | A sticky note per chapter comparing the idea to something everyday. |
| **Doodles** | An SVG sketch per chapter, drawn by Claude and sanitised before display. |
| **In-context lookup** | Tap an underlined term for its index card (meaning in this paper, in plain words, where it shows up, related terms). Select **any** word for a *Look up* button. Press <kbd>/</kbd> or <kbd>⌘K</kbd> to search every card. |
| **Takeaways + quiz** | A receipt of what you just learned after each chapter, and a pop quiz at the end. |
| **Download PDF** | One click downloads a designed A4 article of the tape: a cover with contents, each chapter with its sticky-note analogy, polaroid doodle, quote and takeaways, the glossary, and the quiz with an answer key. Underlined terms are links: click one to jump to its meaning, and the card links back to the chapter. Real text with the site's fonts (in `fonts/`) and vector doodles, made in the browser by [pdfmake](https://pdfmake.github.io) (`js/pdf.js`). From the reader's top bar or the shelf. |

## Layout

```
server.py           local server: static files + Claude explainer jobs (Claude Code CLI)
explainer.json      the explainer prompt and answer schema, shared by server.py and api/claude.js
api/                Vercel functions: Claude via the API (claude.js), access requests, access links, admin
admin.html          /admin page for approving people (js/admin.js)
vercel.json         routes /admin and /access/<link>, gives the Claude function 5 minutes
index.html          home: collage hero, VHS shelf, add-a-paper dialog, on-this-device panel
paper.html          reader for one paper (?id=…)
css/style.css
js/store.js         saved (IndexedDB) vs session-only papers
js/browser-model.js in-browser writer: pdf.js + WebLLM (Qwen3.5), no server needed
js/generate.js      picks the writer (browser or server.py), normalises the explainer
js/drawings.js      built-in doodles + SVG sanitiser
js/lookup.js        index cards, select-to-look-up, card catalogue
js/paper.js         renders a paper
js/home.js          scraps, shelf, dialog
js/pdf.js           builds and downloads a paper's PDF (fonts/: the fonts it embeds, OFL)
```

Explainers are AI-written retellings: check the original paper before citing anything.

---

Built by **Prachiti Palande**.
