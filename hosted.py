"""Hosted mode: people you approve can use Claude (through your Anthropic API key) on a deployed Paper Archive.

Turn it on with PAPER_ARCHIVE_MODE=hosted and set:
  ANTHROPIC_API_KEY    your key from platform.claude.com, billed per use; it never reaches a browser
  ADMIN_PASSWORD       for /admin, where you approve requests and revoke access
Optional:
  OWNER_NAME           shown to visitors ("Prachiti approves each person"), default "the site owner"
  CLAUDE_MODEL         default claude-sonnet-5
  DAILY_LIMIT          papers per person per day, default 3
  MONTHLY_BUDGET_USD   Claude stops for everyone once this month's estimated spend reaches it, default 20
  DATA_DIR             where the SQLite database lives; put it on a persistent disk, default ./data
  PUBLIC_URL           the site's address, for access links (otherwise taken from the request)

Visitors ask for access with a form. The request waits on /admin; approving it makes a personal link
(/access/<token>) for you to send them, and opening it sets a cookie that unlocks Claude on that device.
Only a hash of each token is stored, so a copy of the database can't be used to get in.
"""
import calendar
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OWNER = os.environ.get("OWNER_NAME", "").strip() or "the site owner"
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")
DAILY_LIMIT = int(os.environ.get("DAILY_LIMIT", "3"))
MONTHLY_BUDGET = float(os.environ.get("MONTHLY_BUDGET_USD", "20"))
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(HERE, "data")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
MAX_RUNNING = 3  # Claude jobs at once, across everyone
MAX_PDF = 20 * 1024 * 1024  # base64 inflates it by a third, and a request to Claude tops out at 32 MB

# $ per million tokens (input, output), for the budget estimate. Check platform.claude.com/pricing if prices change.
PRICES = {"claude-sonnet-5": (2, 10), "claude-opus-5": (5, 25), "claude-haiku-4-5": (1, 5)}
NAMES = {"claude-sonnet-5": "Claude Sonnet 5", "claude-opus-5": "Claude Opus 5", "claude-haiku-4-5": "Claude Haiku 4.5"}
MODEL_NAME = NAMES.get(MODEL, MODEL)


def check_config():
    missing = [k for k in ("ANTHROPIC_API_KEY", "ADMIN_PASSWORD") if not os.environ.get(k)]
    if missing:
        raise SystemExit("Hosted mode needs " + " and ".join(missing) + ". See the top of hosted.py.")
    if MODEL not in PRICES:
        print(f"  Note: no price on file for {MODEL}, so the monthly budget can't be tracked.")


def cost(model, input_tokens, output_tokens):
    p_in, p_out = PRICES.get(model, (0, 0))
    return (input_tokens * p_in + output_tokens * p_out) / 1_000_000


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def day_start():
    return time.time() - time.time() % 86400  # UTC midnight


def month_start():
    t = time.gmtime()
    return calendar.timegm((t.tm_year, t.tm_mon, 1, 0, 0, 0))


# ---------------------------------------------------------------- storage

SQL = """
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  created REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decided REAL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created REAL NOT NULL, revoked REAL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, file TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
  started REAL NOT NULL, finished REAL, error TEXT);
"""


class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.executescript(SQL)
            # a restart loses running jobs; don't let them count against anyone's day
            self.db.execute("UPDATE jobs SET status = 'error', error = 'Server restarted' WHERE status = 'running'")

    def rows(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        r = self.rows(sql, args)
        return r[0] if r else None

    def run(self, sql, args=()):
        with self.lock, self.db:
            return self.db.execute(sql, args).lastrowid

    # requests
    def add_request(self, name, email, note):
        old = self.one("SELECT id FROM requests WHERE status = 'pending' AND lower(email) = lower(?)", (email,))
        if old:  # asking twice updates the first request
            self.run("UPDATE requests SET name = ?, note = ?, created = ? WHERE id = ?", (name, note, time.time(), old["id"]))
            return old["id"]
        return self.run("INSERT INTO requests (name, email, note, created) VALUES (?, ?, ?, ?)", (name, email, note, time.time()))

    def approve(self, request_id):
        """Returns (user, token) or None if the request isn't pending."""
        token = secrets.token_urlsafe(24)
        with self.lock, self.db:
            r = self.db.execute("SELECT * FROM requests WHERE id = ? AND status = 'pending'", (request_id,)).fetchone()
            if not r:
                return None
            uid = self.db.execute("INSERT INTO users (name, email, token_hash, created) VALUES (?, ?, ?, ?)",
                                  (r["name"], r["email"], hash_token(token), time.time())).lastrowid
            self.db.execute("UPDATE requests SET status = 'approved', decided = ? WHERE id = ?", (time.time(), request_id))
        return {"id": uid, "name": r["name"], "email": r["email"]}, token

    def deny(self, request_id):
        self.run("UPDATE requests SET status = 'denied', decided = ? WHERE id = ? AND status = 'pending'", (time.time(), request_id))

    # users
    def user_for_token(self, token):
        return self.one("SELECT * FROM users WHERE token_hash = ? AND revoked IS NULL", (hash_token(token),)) if token else None

    def new_link(self, user_id):
        """A fresh link for someone (the old one stops working); also restores revoked access."""
        token = secrets.token_urlsafe(24)
        self.run("UPDATE users SET token_hash = ?, revoked = NULL WHERE id = ?", (hash_token(token), user_id))
        user = self.one("SELECT id, name, email FROM users WHERE id = ?", (user_id,))
        return (user, token) if user else None

    def revoke(self, user_id):
        self.run("UPDATE users SET revoked = ? WHERE id = ? AND revoked IS NULL", (time.time(), user_id))

    # jobs
    def start_job(self, job_id, user_id, file, model):
        self.run("INSERT INTO jobs (id, user_id, file, model, status, started) VALUES (?, ?, ?, ?, 'running', ?)",
                 (job_id, user_id, file[:200], model, time.time()))

    def finish_job(self, job_id, status, input_tokens=0, output_tokens=0, error=None):
        job = self.one("SELECT model FROM jobs WHERE id = ?", (job_id,))
        c = cost(job["model"], input_tokens, output_tokens) if job else 0
        self.run("UPDATE jobs SET status = ?, input_tokens = ?, output_tokens = ?, cost = ?, finished = ?, error = ? WHERE id = ?",
                 (status, input_tokens, output_tokens, c, time.time(), (error or "")[:300] or None, job_id))

    def papers_today(self, user_id):
        return self.one("SELECT count(*) AS n FROM jobs WHERE user_id = ? AND started >= ? AND status IN ('running', 'done')",
                        (user_id, day_start()))["n"]

    def running(self, user_id=None):
        if user_id is None:
            return self.one("SELECT count(*) AS n FROM jobs WHERE status = 'running'")["n"]
        return self.one("SELECT count(*) AS n FROM jobs WHERE status = 'running' AND user_id = ?", (user_id,))["n"]

    def month_spend(self):
        return self.one("SELECT coalesce(sum(cost), 0) AS c FROM jobs WHERE started >= ?", (month_start(),))["c"]

    def admin_state(self):
        return {
            "owner": OWNER, "model": MODEL_NAME, "daily_limit": DAILY_LIMIT, "budget": MONTHLY_BUDGET,
            "month_spend": round(self.month_spend(), 4),
            "month_papers": self.one("SELECT count(*) AS n FROM jobs WHERE started >= ? AND status = 'done'", (month_start(),))["n"],
            "requests": self.rows("SELECT id, name, email, note, created FROM requests WHERE status = 'pending' ORDER BY created"),
            "users": self.rows("""
                SELECT u.id, u.name, u.email, u.created, u.revoked,
                  (SELECT count(*) FROM jobs j WHERE j.user_id = u.id AND j.status = 'done') AS papers,
                  (SELECT count(*) FROM jobs j WHERE j.user_id = u.id AND j.status IN ('running', 'done') AND j.started >= ?) AS today,
                  (SELECT coalesce(sum(cost), 0) FROM jobs j WHERE j.user_id = u.id) AS cost,
                  (SELECT max(started) FROM jobs j WHERE j.user_id = u.id) AS last_used
                FROM users u ORDER BY u.revoked IS NOT NULL, u.created DESC""", (day_start(),)),
            "jobs": self.rows("""
                SELECT j.id, j.file, j.model, j.status, j.input_tokens, j.output_tokens, j.cost, j.started, j.error, u.name
                FROM jobs j JOIN users u ON u.id = j.user_id ORDER BY j.started DESC LIMIT 25"""),
        }


STORE = None


def store():
    global STORE
    if STORE is None:
        STORE = Store(os.path.join(DATA_DIR, "paper-archive.db"))
    return STORE


# ---------------------------------------------------------------- who may do what


def claude_engine(user):
    """The Claude option as this visitor sees it."""
    if not user:
        return {"available": False, "access": "request", "owner": OWNER,
                "note": f"Runs on {OWNER}’s Claude API credit, so it’s for people {OWNER} approves."}
    ok, why = can_start(user)
    left = max(0, DAILY_LIMIT - store().papers_today(user["id"]))
    return {"available": ok, "access": "approved", "owner": OWNER,
            "note": why or f"You’re approved · {MODEL_NAME} · {left} of {DAILY_LIMIT} papers left today"}


def can_start(user):
    s = store()
    if s.papers_today(user["id"]) >= DAILY_LIMIT:
        return False, f"You’ve used today’s {DAILY_LIMIT} papers. Try again tomorrow, or use the in-browser writer."
    if s.running(user["id"]):
        return False, "You already have a paper being written. Wait for it to finish."
    if s.running() >= MAX_RUNNING:
        return False, "Claude is busy with other papers right now. Try again in a few minutes."
    if MODEL in PRICES and s.month_spend() >= MONTHLY_BUDGET:
        return False, f"This month’s Claude budget is used up. Let {OWNER} know, or use the in-browser writer."
    return True, ""


EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def clean_request(data):
    """(name, email, note) from a request form, or raises ValueError with a message for the visitor."""
    if not isinstance(data, dict):
        raise ValueError("Something went wrong. Reload the page and try again.")
    name = " ".join(str(data.get("name") or "").split())[:80]
    email = str(data.get("email") or "").strip()[:120]
    note = str(data.get("note") or "").strip()[:500]
    if not name:
        raise ValueError("Please add your name.")
    if not EMAIL.fullmatch(email):
        raise ValueError("Please add an email address that works, so you can get your link.")
    return name, email, note


class Throttle:
    """At most `limit` hits per key in `per` seconds (kept in memory; good enough to slow down spam)."""

    def __init__(self, limit, per):
        self.limit, self.per, self.hits, self.lock = limit, per, {}, threading.Lock()

    def allow(self, key):
        now = time.time()
        with self.lock:
            recent = [t for t in self.hits.get(key, []) if now - t < self.per]
            if len(recent) >= self.limit:
                self.hits[key] = recent
                return False
            self.hits[key] = recent + [now]
            return True


REQUESTS = Throttle(3, 3600)
LOGINS = Throttle(8, 900)

# ---------------------------------------------------------------- admin sessions

ADMIN_SESSIONS = {}  # token -> expiry; kept in memory, so a restart signs you out
ADMIN_HOURS = 12


def admin_login(password):
    if not hmac.compare_digest(password.encode(), os.environ.get("ADMIN_PASSWORD", "").encode()):
        return None
    token = secrets.token_urlsafe(32)
    ADMIN_SESSIONS[token] = time.time() + ADMIN_HOURS * 3600
    return token


def is_admin(token):
    expiry = ADMIN_SESSIONS.get(token or "")
    if expiry and expiry > time.time():
        return True
    ADMIN_SESSIONS.pop(token or "", None)
    return False


def admin_logout(token):
    ADMIN_SESSIONS.pop(token or "", None)
