/* GET /access/<token> (rewritten to /api/access?token=…): an approved person's link. It sets a cookie that
   unlocks Claude on this device and opens the add-paper dialog. */
import { configured, setCookie, userFor } from "./_lib.js";

const INVALID = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>Link not valid</title><body style="font:17px/1.5 Georgia,serif;background:#0d0c0b;color:#ece6d8;padding:40px">
<h1>This link doesn’t work any more.</h1><p>Ask for a new one, or <a style="color:#f5b3cd" href="/">go to Paper Archive</a>
and use the in-browser writer.</p>`;

export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (configured() && /^[\w-]{20,64}$/.test(token) && (await userFor(token))) {
    return new Response(null, { status: 303, headers: { Location: "/#new", "Set-Cookie": setCookie(request, "pa_access", token, 365 * 86400), "Cache-Control": "no-store" } });
  }
  return new Response(INVALID, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
