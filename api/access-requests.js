/* POST /api/access-requests {name, email, note}: someone asks the owner for access to Claude. */
import { OWNER, addRequest, allow, clientIp, configured, fromSite, json, readJson } from "./_lib.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request) {
  if (!fromSite(request)) return json(403, { error: "forbidden" });
  if (!configured()) return json(503, { error: `Claude isn’t set up on this site yet. Let ${OWNER} know.` });
  const data = await readJson(request);
  if (!data || typeof data !== "object") return json(400, { error: "Something went wrong. Reload the page and try again." });
  const name = String(data.name || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 80);
  const email = String(data.email || "").trim().slice(0, 120);
  const note = String(data.note || "").trim().slice(0, 500);
  if (!name) return json(400, { error: "Please add your name." });
  if (!EMAIL.test(email)) return json(400, { error: "Please add an email address that works, so you can get your link." });
  if (!(await allow("req", clientIp(request), 3, 3600))) return json(429, { error: "Too many requests from here. Try again in an hour." });
  await addRequest(name, email, note);
  return json(200, { ok: true, owner: OWNER });
}
