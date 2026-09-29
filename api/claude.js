/* POST /api/claude?name=<file>  (body: the PDF). For approved people only.
   Sends the PDF to Claude and streams newline-delimited JSON back: progress lines ({phase, detail, chars}),
   then {done, result, usage} or {error}. Everything happens in this one request, because a Vercel Function
   can't keep working after it answers. It stops Claude early if the visitor leaves or time runs out. */
import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { MAX_PDF, MODEL, MODEL_NAME, OWNER, SCHEMA, SYSTEM, canStart, configured, cookie, finishJob, fromSite, json, startJob, userFor } from "./_lib.js";

const TIME_LIMIT = 285_000; // ms: under Vercel's 5-minute cap, leaving time to report the problem

const chapterHint = (text) => {
  const titles = [...text.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  return titles.length > 1 ? titles[titles.length - 1][1] : "";
};

function explain(error, timedOut) {
  if (timedOut) return "Claude needed more than 5 minutes for this paper, which is longer than this site allows. Try a shorter paper, or the in-browser writer.";
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return `This site’s Claude API key isn’t working. Let ${OWNER} know.`;
  if (error instanceof Anthropic.RateLimitError) return "Claude is busy right now. Try again in a minute.";
  if (error instanceof Anthropic.BadRequestError) {
    return /credit|balance|billing/i.test(error.message) ? `This site’s Claude credit has run out. Let ${OWNER} know.`
      : "Claude couldn’t take this PDF (it may be too long or damaged).";
  }
  if (error instanceof Anthropic.APIError) return "Claude is having trouble right now. Try again shortly.";
  return error.message || "Something went wrong.";
}

export async function POST(request) {
  if (!fromSite(request)) return json(403, { error: "forbidden" });
  if (!configured()) return json(503, { error: `Claude isn’t set up on this site yet. Let ${OWNER} know.` });
  const user = await userFor(cookie(request, "pa_access"));
  if (!user) return json(403, { error: `Claude is only for people ${OWNER} has approved. Ask for access, or use the in-browser writer.` });
  const why = await canStart(user);
  if (why) return json(429, { error: why });
  const pdf = Buffer.from(await request.arrayBuffer());
  if (pdf.length > MAX_PDF) return json(413, { error: "For Claude on this site the PDF must be under 4.4 MB." });
  if (pdf.subarray(0, 4).toString() !== "%PDF") return json(400, { error: "That file isn’t a PDF." });
  const job = await startJob(user, new URL(request.url).searchParams.get("name"));
  if (!job) return json(429, { error: "You already have a paper being written. Wait for it to finish." });

  // Stop Claude if the visitor leaves (so the rest isn't billed) or time runs out. Recording the cost must
  // still happen after that, so it runs under waitUntil.
  const stop = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stop.abort(); }, TIME_LIMIT);
  request.signal.addEventListener("abort", () => stop.abort());
  const recorded = Promise.withResolvers();
  waitUntil(recorded.promise);

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (msg) => { try { controller.enqueue(encoder.encode(JSON.stringify(msg) + "\n")); } catch { /* the visitor left */ } };
      const started = Date.now();
      const progress = { phase: "reading", detail: "", chars: 0 };
      let written = "", inTok = 0, outTok = 0, status = "error", error = null, lastSent = 0;
      const report = (force) => {
        if (force || Date.now() - lastSent > 1000) { lastSent = Date.now(); send({ ...progress, elapsed: Math.round((Date.now() - started) / 1000) }); }
      };
      const heartbeat = setInterval(() => report(true), 5000); // keeps the connection alive while Claude thinks
      report(true);
      try {
        const client = new Anthropic(); // ANTHROPIC_API_KEY
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          system: SYSTEM,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
          messages: [{ role: "user", content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
            { type: "text", text: "Write the explainer for this paper." },
          ] }],
        }, { signal: stop.signal });
        for await (const event of stream) {
          if (event.type === "message_start") inTok = event.message.usage.input_tokens;
          else if (event.type === "content_block_start" && event.content_block.type === "thinking") { progress.phase = "thinking"; report(true); }
          else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            written += event.delta.text;
            const started = progress.phase !== "writing";
            Object.assign(progress, { phase: "writing", detail: chapterHint(written), chars: written.length });
            report(started); // say so at once when writing starts, then at most once a second
          }
        }
        const message = await stream.finalMessage();
        inTok = message.usage.input_tokens;
        outTok = message.usage.output_tokens;
        if (message.stop_reason === "refusal") throw new Error("Claude declined to explain this paper.");
        if (message.stop_reason === "max_tokens") throw new Error("Claude ran out of room before finishing. Try a shorter paper.");
        const text = message.content.find((b) => b.type === "text");
        const result = JSON.parse(text.text);
        send({ done: true, result, usage: { engine: "claude-api", model: MODEL_NAME, input: inTok, output: outTok } });
        status = "done";
      } catch (e) {
        status = request.signal.aborted ? "cancelled" : "error";
        error = explain(e, timedOut);
        send({ error });
      } finally {
        clearInterval(heartbeat);
        clearTimeout(timer);
        if (!outTok && written) outTok = Math.round(written.length / 3.5); // a run cut short: estimate what it cost
        try { await finishJob(job, status, inTok, outTok, status === "done" ? null : error); } finally { recorded.resolve(); }
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
