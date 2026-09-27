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

`server.py` uses only the Python standard library. It serves the site and writes the explainers, and it only
answers requests from this machine. **No API key is needed.**

## Adding a paper

1. Click a blank tape (or **+ Add a paper**) and drop in a PDF.
2. Choose who writes the explainer:
   - **Claude:** runs the Claude Code CLI you're already signed in to, so it counts toward your Claude plan like
     any other chat. Best explanations, reads scanned pages, and takes about 1–5 minutes. The CLI is found on your
     PATH or inside the Claude Code VS Code extension (set `CLAUDE_BIN` to override).
   - **Ollama:** extracts the text with `pdftotext` and asks a local model. Free and private, but a small model like
     `gemma3:4b` on 8 GB of RAM is slow (several minutes even for a short paper) and gives much thinner explainers.
     Ollama must be running; long papers are refused rather than cut off.
3. When it's ready you're asked **whether to keep it on this device**:
   - **Yes:** saved in this browser (IndexedDB) until you remove it.
   - **No:** kept only for this session and gone when the tab closes.

You can change your mind later from the shelf or the reader ("Keep it" / "Don't keep" / "Remove"). The
**On this device** panel lists everything stored. The PDF itself is never kept: the server reads it from a
temporary folder that's deleted when the job ends.

### Safety

- The Claude run is locked down: `--tools Read --restricted --strict-mcp-config`, in a throwaway folder that only
  holds the PDF, so text inside a paper can't make it run commands or touch other files.
- Everything the model writes is treated as untrusted: text is HTML-escaped (only `**bold**`, `*italic*` and
  `{{term|id}}` links render) and doodles go through an allow-list SVG sanitiser (`PA.safeSVG`).
- The API only accepts requests to `localhost` carrying the site's own header, so other websites can't use it.

## What's on each paper page

| Piece | What it does |
|---|---|
| **Chapters** | One per section of the original, in plain words, with key terms underlined. |
| **Analogy notes** | A sticky note per chapter comparing the idea to something everyday. |
| **Doodles** | An SVG sketch per chapter, drawn by Claude and sanitised before display. |
| **In-context lookup** | Tap an underlined term for its index card (meaning in this paper, in plain words, where it shows up, related terms). Select **any** word for a *Look up* button. Press <kbd>/</kbd> or <kbd>⌘K</kbd> to search every card. |
| **Takeaways + quiz** | A receipt of what you just learned after each chapter, and a pop quiz at the end. |

## Layout

```
server.py           local server: static files + explainer jobs (Claude Code CLI or Ollama)
index.html          home: collage hero, VHS shelf, add-a-paper dialog, on-this-device panel
paper.html          reader for one paper (?id=…)
css/style.css
js/store.js         saved (IndexedDB) vs session-only papers, API key
js/generate.js      sends the PDF to server.py, polls the job, normalises the explainer
js/drawings.js      built-in doodles + SVG sanitiser
js/lookup.js        index cards, select-to-look-up, card catalogue
js/paper.js         renders a paper
js/home.js          scraps, shelf, dialog
```

Explainers are AI-written retellings: check the original paper before citing anything.

---

Built by **Prachiti Palande**.
