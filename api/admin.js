/* /api/admin, for the owner. GET: requests, people, spending. POST {action, ...}: login, logout, approve,
   deny, revoke, link (a new link, which also restores revoked access). */
import { adminLogin, adminLogout, adminState, allow, approve, clientIp, configured, deny, fromSite, isAdmin, json, newLink, readJson, revoke } from "./_lib.js";

export async function GET(request) {
  if (!fromSite(request)) return json(403, { error: "forbidden" });
  if (!configured()) return json(503, { error: "Finish the setup first: see “Deploy it on Vercel” in the README." });
  if (!(await isAdmin(request))) return json(401, { error: "Sign in first." });
  return json(200, await adminState());
}

export async function POST(request) {
  if (!fromSite(request)) return json(403, { error: "forbidden" });
  if (!configured()) return json(503, { error: "Finish the setup first: see “Deploy it on Vercel” in the README." });
  const { action, id, password } = (await readJson(request)) || {};
  if (action === "login") {
    if (!(await allow("login", clientIp(request), 8, 900))) return json(429, { error: "Too many tries. Wait 15 minutes." });
    const setCookie = await adminLogin(request, password);
    return setCookie ? json(200, { ok: true }, { "Set-Cookie": setCookie }) : json(401, { error: "That password isn’t right." });
  }
  if (action === "logout") return json(200, { ok: true }, { "Set-Cookie": await adminLogout(request) });
  if (!(await isAdmin(request))) return json(401, { error: "Sign in first." });
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return json(400, { error: "Unknown request or person." });
  if (action === "deny") { await deny(n); return json(200, { ok: true }); }
  if (action === "revoke") { await revoke(n); return json(200, { ok: true }); }
  if (action === "approve" || action === "link") {
    const made = action === "approve" ? await approve(n) : await newLink(n);
    if (!made) return json(404, { error: "That was already handled." });
    return json(200, { ok: true, user: made.user, link: `${new URL(request.url).origin}/access/${made.token}` });
  }
  return json(400, { error: "Unknown action." });
}
