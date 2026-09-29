"""Paper Archive local server: serves the site and lets Claude write explainers without an API key.

It runs the Claude Code CLI you're already signed in to (your Claude plan, no API key). Claude gets the PDF
in a throwaway folder and may only use its Read tool. The in-browser writer (js/browser-model.js) needs
none of this, so the site also works on a static host. Deployed on Vercel, the Claude option is the Claude
API for people the owner approves instead (api/): see the README.

Run:  python3 server.py        then open http://localhost:8000
"""
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8000"))
MAX_PDF = 40 * 1024 * 1024

# ---------------------------------------------------------------- what we ask for

# The prompt and answer shape are shared with the Vercel function (api/claude.js).
with open(os.path.join(HERE, "explainer.json"), encoding="utf-8") as f:
    EXPLAINER = json.load(f)
SCHEMA = EXPLAINER["schema"]
CLAUDE_SYSTEM = (EXPLAINER["system"]
                 .replace("<<SOURCE>>", "The paper is the PDF file paper.pdf in your working directory. Read all of it first "
                                        "(use the pages parameter to read it in parts of up to 20 pages), then write.")
                 .replace("<<CHAPTERS>>", "usually 4–8").replace("<<TERMS>>", "20–50"))

# ---------------------------------------------------------------- engines


def find_claude():
    """The Claude Code CLI: on PATH, or bundled with the VS Code extension."""
    if os.environ.get("CLAUDE_BIN"):
        return os.environ["CLAUDE_BIN"]
    found = shutil.which("claude")
    if found:
        return found
    home = os.path.expanduser("~")
    candidates = [os.path.join(home, ".claude", "local", "claude"), os.path.join(home, ".local", "bin", "claude")]
    for pattern in (".vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude",
                    ".cursor/extensions/anthropic.claude-code-*/resources/native-binary/claude"):
        def version(p):
            m = re.search(r"claude-code-(\d+)\.(\d+)\.(\d+)", p)
            return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
        candidates += sorted(glob.glob(os.path.join(home, pattern)), key=version, reverse=True)
    return next((c for c in candidates if os.access(c, os.X_OK)), None)


def engines():
    claude = find_claude()
    return {
        "claude": {"available": bool(claude),
                   "note": "Uses your Claude login (the same account as the Claude app)." if claude
                   else "Claude Code isn’t installed. Install it from claude.com/claude-code and sign in."},
    }


# ---------------------------------------------------------------- jobs

JOBS = {}
LOCK = threading.Lock()


class Job:
    def __init__(self, engine, model, name):
        self.id = uuid.uuid4().hex[:12]
        self.engine, self.model, self.name = engine, model, name
        self.status, self.phase, self.detail, self.chars = "running", "starting", "", 0
        self.result, self.usage, self.error = None, None, None
        self.started = time.time()
        self.proc = None
        self.cancelled = False

    def view(self):
        v = {"status": self.status, "phase": self.phase, "detail": self.detail, "chars": self.chars,
             "elapsed": round(time.time() - self.started)}
        if self.status == "done":
            v.update(result=self.result, usage=self.usage)
        if self.status == "error":
            v["error"] = self.error
        return v


def chapter_hint(text):
    titles = re.findall(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    return titles[-1] if len(titles) > 1 else ""


def drain(stream, tail):
    for line in stream:
        tail.append(line)
        del tail[:-40]


def run_claude(job, pdf_bytes):
    work = tempfile.mkdtemp(prefix="paper-archive-")
    try:
        with open(os.path.join(work, "paper.pdf"), "wb") as f:
            f.write(pdf_bytes)
        cmd = [find_claude(), "-p", "Read paper.pdf and write its explainer.",
               "--output-format", "stream-json", "--verbose", "--include-partial-messages",
               "--json-schema", json.dumps(SCHEMA),
               "--system-prompt", CLAUDE_SYSTEM,
               "--tools", "Read", "--allowedTools", "Read",
               "--restricted", "--strict-mcp-config", "--no-session-persistence"]
        if job.model:
            cmd += ["--model", job.model]
        env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
        job.proc = subprocess.Popen(cmd, cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        err_tail = []
        threading.Thread(target=drain, args=(job.proc.stderr, err_tail), daemon=True).start()

        job.phase = "reading"
        final, written = None, ""
        for line in job.proc.stdout:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            t = ev.get("type")
            if t == "assistant":
                for block in ev.get("message", {}).get("content", []):
                    if block.get("type") == "tool_use" and block.get("name") == "Read":
                        pages = (block.get("input") or {}).get("pages")
                        job.phase, job.detail = "reading", f"pages {pages}" if pages else ""
            elif t == "stream_event":
                e = ev.get("event", {})
                d = e.get("delta", {})
                if e.get("type") == "content_block_start" and e.get("content_block", {}).get("type") == "thinking":
                    job.phase, job.detail = "thinking", ""
                piece = d.get("partial_json") or d.get("text") or ""
                if piece:
                    written += piece
                    job.chars = len(written)
                    if job.chars > 400:
                        job.phase, job.detail = "writing", chapter_hint(written)
            elif t == "result":
                final = ev
        job.proc.wait()

        if job.cancelled:
            job.status = "cancelled"
            return
        if not final:
            raise RuntimeError("Claude stopped without an answer. " + "".join(err_tail)[-300:].strip())
        if final.get("is_error") or not isinstance(final.get("structured_output"), dict):
            msg = str(final.get("result") or final.get("subtype") or "unknown error")
            if re.search(r"log ?in|auth|credential", msg, re.I):
                msg = "Claude Code isn’t signed in. Open the Claude app or run `claude` once in Terminal to sign in."
            raise RuntimeError(msg[:400])
        u = final.get("usage") or {}
        per_model = final.get("modelUsage") or {}
        main_model = max(per_model, key=lambda m: per_model[m].get("outputTokens", 0), default="")
        job.usage = {"engine": "claude", "model": main_model,
                     "input": (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0),
                     "output": u.get("output_tokens") or 0}
        job.result = final["structured_output"]
        job.status = "done"
    except Exception as e:
        job.status, job.error = ("cancelled", None) if job.cancelled else ("error", str(e))
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------- HTTP


def static_path(path):
    """Only the site's own pages, styles and scripts are served: never this file, the repo or dotfiles."""
    if path == "/":
        return "/index.html"
    if path in ("/index.html", "/paper.html") or (re.fullmatch(r"/(css|js)/[\w.-]+\.(css|js)", path) and os.path.isfile(HERE + path)):
        return path
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def local_only(self):
        """Only this site may call the API: other web pages can't send the custom header without a CORS
        preflight, which this server never approves, and the Host must be this machine."""
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("localhost", "127.0.0.1") or self.headers.get("X-Paper-Archive") != "1":
            self.send_json(403, {"error": "forbidden"})
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            if not self.local_only():
                return
            if path == "/api/engines":
                return self.send_json(200, engines())
            m = re.fullmatch(r"/api/jobs/([0-9a-f]{12})", path)
            job = JOBS.get(m.group(1)) if m else None
            return self.send_json(200, job.view()) if job else self.send_json(404, {"error": "no such job"})
        target = static_path(path)
        if not target:
            return self.send_error(404)
        self.path = target
        return super().do_GET()

    def do_HEAD(self):
        target = static_path(urlparse(self.path).path)
        if not target:
            return self.send_error(404)
        self.path = target
        return super().do_HEAD()

    def do_POST(self):
        url = urlparse(self.path)
        if not self.local_only():
            return
        m = re.fullmatch(r"/api/jobs/([0-9a-f]{12})/cancel", url.path)
        if m:
            job = JOBS.get(m.group(1))
            if job and job.status == "running":
                job.cancelled = True
                try:
                    job.proc and job.proc.terminate()
                except Exception:
                    pass
            return self.send_json(200, {"ok": True})
        if url.path != "/api/jobs":
            return self.send_json(404, {"error": "not found"})

        q = parse_qs(url.query)
        engine = (q.get("engine") or [""])[0]
        model = (q.get("model") or [""])[0]
        name = (q.get("name") or ["paper.pdf"])[0]
        size = int(self.headers.get("Content-Length") or 0)
        if not 0 < size <= MAX_PDF:
            self.rfile.read(min(size, 64 * 1024 * 1024))  # read it anyway, or the browser gets no message
            return self.send_json(413, {"error": "The PDF must be under 40 MB."})
        data = self.rfile.read(size)
        if not data.startswith(b"%PDF"):
            return self.send_json(400, {"error": "That file isn’t a PDF."})
        eng = engines()
        if engine not in eng or not eng[engine]["available"]:
            return self.send_json(400, {"error": eng.get(engine, {}).get("note", "Unknown engine.")})
        if engine == "claude" and model and not re.fullmatch(r"[a-z0-9.\-]+", model):
            return self.send_json(400, {"error": "Unknown model."})

        job = Job(engine, model, name)
        with LOCK:
            JOBS[job.id] = job
        threading.Thread(target=run_claude, args=(job, data), daemon=True).start()
        self.send_json(200, {"id": job.id})


if __name__ == "__main__":
    info = engines()
    print(f"Paper Archive → http://localhost:{PORT}")
    print(f"  Claude: {'ready' if info['claude']['available'] else info['claude']['note']}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
