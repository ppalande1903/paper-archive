/* Shared by the Vercel functions in api/: settings, the Redis store, cookies, approvals and spending limits.

   On Vercel, people the owner approves can use Claude through the owner's Anthropic API key (never their
   Claude plan). Visitors ask for access; the owner approves them on /admin and sends a personal link
   (/access/<token>) that sets a cookie. Only hashes of links and admin sessions are stored.

   Settings (Vercel → Project → Settings → Environment Variables):
     ANTHROPIC_API_KEY    from platform.claude.com, billed per use
     ADMIN_PASSWORD       for /admin
     OWNER_NAME           shown to visitors, e.g. "Prachiti"
     CLAUDE_MODEL         default claude-sonnet-5
     DAILY_LIMIT          papers per person per day, default 3
     MONTHLY_BUDGET_USD   Claude stops for everyone once this month's estimated spend reaches it, default 20
     KV_REST_API_URL / KV_REST_API_TOKEN   added for you when you connect an Upstash Redis database
       (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN work too) */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import explainer from "../explainer.json" with { type: "json" };

export const OWNER = (process.env.OWNER_NAME || "").trim() || "the site owner";
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
export const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 3);
export const MONTHLY_BUDGET = Number(process.env.MONTHLY_BUDGET_USD || 20);
export const MAX_PDF = 4.4 * 1024 * 1024; // Vercel refuses request bodies over 4.5 MB
const MAX_RUNNING = 3; // Claude papers at once, across everyone
const RUN_TTL = 330; // seconds: a little over Vercel's 5-minute limit, in case a run dies without cleaning up

// $ per million tokens (input, output), for the budget estimate. Check platform.claude.com/pricing if they change.
const PRICES = { "claude-sonnet-5": [2, 10], "claude-opus-5": [5, 25], "claude-haiku-4-5": [1, 5] };
const NAMES = { "claude-sonnet-5": "Claude Sonnet 5", "claude-opus-5": "Claude Opus 5", "claude-haiku-4-5": "Claude Haiku 4.5" };
export const MODEL_NAME = NAMES[MODEL] || MODEL;
export const cost = (inTok, outTok) => { const [a, b] = PRICES[MODEL] || [0, 0]; return (inTok * a + outTok * b) / 1e6; };

export const SCHEMA = explainer.schema;
export const SYSTEM = explainer.system
  .replace("<<SOURCE>>", "The paper is the PDF attached to the message. Read all of it, then write.")
  .replace("<<CHAPTERS>>", "usually 4–8").replace("<<TERMS>>", "20–50");

/* ---------------------------------------------------------------- responses and requests */

export const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

/* Only the site's own pages send this header; another site can't without a CORS preflight, which we never approve. */
export const fromSite = (request) => request.headers.get("x-paper-archive") === "1";

export function cookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

export function setCookie(request, name, value, maxAge, sameSite = "Lax") {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
}

export const clientIp = (request) =>
  request.headers.get("x-real-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

const hash = (s) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");
const day = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);

/* ---------------------------------------------------------------- Redis (Upstash REST API) */

const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const configured = () => Boolean(R_URL && R_TOKEN && process.env.ANTHROPIC_API_KEY && process.env.ADMIN_PASSWORD);

async function redis(...command) {
  const r = await fetch(R_URL, { method: "POST", headers: { Authorization: `Bearer ${R_TOKEN}` }, body: JSON.stringify(command) });
  const data = await r.json();
  if (data.error) throw new Error("Redis: " + data.error);
  return data.result;
}

async function pipeline(commands) {
  if (!commands.length) return [];
  const r = await fetch(`${R_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${R_TOKEN}` }, body: JSON.stringify(commands) });
  const data = await r.json();
  const bad = Array.isArray(data) ? data.find((d) => d.error) : data;
  if (bad && bad.error) throw new Error("Redis: " + bad.error);
  return data.map((d) => d.result);
}

const K = (...parts) => ["pa", ...parts].join(":");
const parse = (s) => (s ? JSON.parse(s) : null);
const hashObject = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]; return o; };

/* ---------------------------------------------------------------- access requests and people */

export async function addRequest(name, email, note) {
  const mailKey = K("reqmail", email.toLowerCase());
  const existing = await redis("GET", mailKey);
  const id = existing ? Number(existing) : await redis("INCR", K("req", "seq"));
  await pipeline([
    ["SET", K("req", id), JSON.stringify({ id, name, email, note, created: Date.now() })],
    ["ZADD", K("reqs"), Date.now(), id],
    ["SET", mailKey, id],
  ]);
}

async function takeRequest(id) {
  const req = parse(await redis("GET", K("req", id)));
  if (!req) return null;
  await pipeline([["ZREM", K("reqs"), id], ["DEL", K("req", id)], ["DEL", K("reqmail", req.email.toLowerCase())]]);
  return req;
}

export async function approve(id) {
  const req = await takeRequest(id);
  if (!req) return null;
  const uid = await redis("INCR", K("user", "seq"));
  const token = newToken();
  const user = { id: uid, name: req.name, email: req.email, created: Date.now(), revoked: null, tokenHash: hash(token) };
  await pipeline([["SET", K("user", uid), JSON.stringify(user)], ["ZADD", K("users"), user.created, uid], ["SET", K("tok", user.tokenHash), uid]]);
  return { user: { id: uid, name: user.name, email: user.email }, token };
}

export const deny = (id) => takeRequest(id);

async function getUser(uid) {
  return parse(await redis("GET", K("user", uid)));
}

export async function userFor(token) {
  if (!token) return null;
  const uid = await redis("GET", K("tok", hash(token)));
  const user = uid && (await getUser(uid));
  return user && !user.revoked && user.tokenHash === hash(token) ? user : null;
}

/* A fresh link (the old one stops working); also restores revoked access. */
export async function newLink(uid) {
  const user = await getUser(uid);
  if (!user) return null;
  const token = newToken();
  const old = user.tokenHash;
  Object.assign(user, { tokenHash: hash(token), revoked: null });
  await pipeline([["DEL", K("tok", old)], ["SET", K("user", uid), JSON.stringify(user)], ["SET", K("tok", user.tokenHash), uid]]);
  return { user: { id: uid, name: user.name, email: user.email }, token };
}

export async function revoke(uid) {
  const user = await getUser(uid);
  if (!user || user.revoked) return;
  user.revoked = Date.now();
  await pipeline([["DEL", K("tok", user.tokenHash)], ["SET", K("user", uid), JSON.stringify(user)]]);
}

/* ---------------------------------------------------------------- limits and spending */

const papersToday = async (uid) => Number((await redis("GET", K("day", uid, day()))) || 0);
const monthSpend = async () => Number((await redis("GET", K("spend", month()))) || 0);

async function runningCount() {
  await redis("ZREMRANGEBYSCORE", K("running"), "-inf", Date.now() - RUN_TTL * 1000);
  return Number(await redis("ZCARD", K("running")));
}

export async function canStart(user) {
  if ((await papersToday(user.id)) >= DAILY_LIMIT) return `You’ve used today’s ${DAILY_LIMIT} papers. Try again tomorrow, or use the in-browser writer.`;
  if (await redis("EXISTS", K("busy", user.id))) return "You already have a paper being written. Wait for it to finish.";
  if ((await runningCount()) >= MAX_RUNNING) return "Claude is busy with other papers right now. Try again in a few minutes.";
  if (PRICES[MODEL] && (await monthSpend()) >= MONTHLY_BUDGET) return `This month’s Claude budget is used up. Let ${OWNER} know, or use the in-browser writer.`;
  return "";
}

/* The Claude option as this visitor sees it. */
export async function claudeEngine(user) {
  const base = { owner: OWNER, stream: true, max_bytes: MAX_PDF };
  if (!configured()) return { ...base, available: false, note: `Not set up on this site yet. ${OWNER} needs to finish the setup.` };
  if (!user) return { ...base, available: false, access: "request", note: `Runs on ${OWNER}’s Claude API credit, so it’s for people ${OWNER} approves.` };
  const why = await canStart(user);
  const left = Math.max(0, DAILY_LIMIT - (await papersToday(user.id)));
  return { ...base, available: !why, access: "approved", note: why || `You’re approved · ${MODEL_NAME} · ${left} of ${DAILY_LIMIT} papers left today` };
}

/* Claims a run for this person; returns a job, or null if they already have one going (race-safe). */
export async function startJob(user, file) {
  const id = randomBytes(6).toString("hex");
  if ((await redis("SET", K("busy", user.id), id, "NX", "EX", RUN_TTL)) !== "OK") return null;
  await pipeline([
    ["INCR", K("day", user.id, day())], ["EXPIRE", K("day", user.id, day()), 2 * 86400],
    ["ZADD", K("running"), Date.now(), id],
  ]);
  return { id, user: user.id, name: user.name, file: String(file || "paper.pdf").slice(0, 200), started: Date.now() };
}

export async function finishJob(job, status, inTok, outTok, error) {
  const c = cost(inTok, outTok);
  const record = { ...job, status, input_tokens: inTok, output_tokens: outTok, cost: c, error: error || null, finished: Date.now() };
  await pipeline([
    ["DEL", K("busy", job.user)], ["ZREM", K("running"), job.id],
    // only finished papers count towards the daily limit
    ...(status === "done" ? [] : [["DECR", K("day", job.user, new Date(job.started).toISOString().slice(0, 10))]]),
    ["INCRBYFLOAT", K("spend", month()), c],
    ...(status === "done" ? [["INCR", K("papers", month())], ["HINCRBY", K("ustat", job.user), "papers", 1]] : []),
    ["HINCRBYFLOAT", K("ustat", job.user), "cost", c],
    ["HSET", K("ustat", job.user), "last_used", job.started],
    ["LPUSH", K("jobs"), JSON.stringify(record)], ["LTRIM", K("jobs"), 0, 24],
  ]);
}

/* At most `limit` hits per key in `seconds`. */
export async function allow(kind, key, limit, seconds) {
  const k = K("rl", kind, key);
  const n = await redis("INCR", k);
  if (n === 1) await redis("EXPIRE", k, seconds);
  return n <= limit;
}

/* ---------------------------------------------------------------- admin */

const ADMIN_HOURS = 12;

export async function adminLogin(request, password) {
  const a = hash(String(password || "")), b = hash(process.env.ADMIN_PASSWORD || "");
  if (!process.env.ADMIN_PASSWORD || !timingSafeEqual(Buffer.from(a), Buffer.from(b))) return null;
  const token = newToken();
  await redis("SET", K("adm", hash(token)), "1", "EX", ADMIN_HOURS * 3600);
  return setCookie(request, "pa_admin", token, ADMIN_HOURS * 3600, "Strict");
}

export async function isAdmin(request) {
  const token = cookie(request, "pa_admin");
  return Boolean(token && (await redis("GET", K("adm", hash(token)))));
}

export async function adminLogout(request) {
  const token = cookie(request, "pa_admin");
  if (token) await redis("DEL", K("adm", hash(token)));
  return setCookie(request, "pa_admin", "", 0, "Strict");
}

export async function adminState() {
  const reqIds = await redis("ZRANGE", K("reqs"), 0, -1);
  const userIds = (await redis("ZRANGE", K("users"), 0, -1)).reverse();
  const [reqs, users, spend, papers, jobs] = await pipeline([
    ["MGET", K("req", "none"), ...reqIds.map((id) => K("req", id))],
    ["MGET", K("user", "none"), ...userIds.map((id) => K("user", id))],
    ["GET", K("spend", month())], ["GET", K("papers", month())], ["LRANGE", K("jobs"), 0, 24],
  ]);
  const stats = await pipeline(userIds.flatMap((id) => [["HGETALL", K("ustat", id)], ["GET", K("day", id, day())]]));
  return {
    owner: OWNER, model: MODEL_NAME, daily_limit: DAILY_LIMIT, budget: MONTHLY_BUDGET,
    month_spend: Number(spend || 0), month_papers: Number(papers || 0),
    requests: reqs.slice(1).filter(Boolean).map(parse).map((r) => ({ ...r, created: r.created / 1000 })),
    users: users.slice(1).map(parse).filter(Boolean).map((u, i) => {
      const s = hashObject(stats[2 * i]);
      return { id: u.id, name: u.name, email: u.email, created: u.created / 1000, revoked: u.revoked && u.revoked / 1000,
               papers: Number(s.papers || 0), today: Number(stats[2 * i + 1] || 0), cost: Number(s.cost || 0),
               last_used: s.last_used ? Number(s.last_used) / 1000 : null };
    }).sort((a, b) => Boolean(a.revoked) - Boolean(b.revoked)),
    jobs: jobs.map(parse).map((j) => ({ ...j, started: j.started / 1000 })),
  };
}
