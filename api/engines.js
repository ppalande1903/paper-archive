/* GET /api/engines: what the Claude option looks like for this visitor (the in-browser writer needs no server). */
import { claudeEngine, cookie, fromSite, json, userFor, configured } from "./_lib.js";

export async function GET(request) {
  if (!fromSite(request)) return json(403, { error: "forbidden" });
  const user = configured() ? await userFor(cookie(request, "pa_access")) : null;
  return json(200, { claude: await claudeEngine(user) });
}
