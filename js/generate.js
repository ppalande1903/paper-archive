/* Gets an explainer written for a PDF, then cleans up the result. Two writers:
   "browser" runs a small open model on this device (js/browser-model.js) and works anywhere, even on a
   static host; "claude" asks server.py, which runs Claude Code on the user's own Claude login locally, or,
   on a deployed site, the Claude API for people the owner has approved. */
window.PA = window.PA || {};

(function () {
  const API = { headers: { "X-Paper-Archive": "1" } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(path, opts = {}) {
    let r;
    try { r = await fetch(path, { ...opts, headers: { ...API.headers, ...(opts.headers || {}) } }); }
    catch (e) { throw new Error("Can’t reach the Paper Archive server. Start it with: python3 server.py"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || (r.status === 404 ? "Can’t reach the Paper Archive server. Start it with: python3 server.py" : "Server error " + r.status));
    return data;
  }

  /* Which writers this browser can use. Claude only exists when the site is served by server.py. */
  PA.engines = async () => {
    const [browser, server] = await Promise.all([PA.browserModel.check(), api("/api/engines").catch(() => null)]);
    return {
      browser,
      claude: server ? server.claude : { available: false, note: "Only when you run Paper Archive on your own computer with python3 server.py." },
    };
  };

  /* Asks the owner of a deployed site for access to Claude. */
  PA.requestAccess = (details) => api("/api/access-requests", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(details),
  });

  const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const SPINES = [["#b3201b", "#f4ecdc"], ["#1b2f6b", "#e8e0cc"], ["#2b5aa8", "#f2d24b"], ["#23402c", "#e9e1cf"], ["#5b1f5f", "#f5b3cd"], ["#e9e1cf", "#8a1c17"], ["#0f0f0f", "#e4c867"], ["#8a1c17", "#f3e6c8"]];

  function normalize(raw, fileName, usage) {
    const glossary = {};
    (raw.glossary || []).forEach((g) => {
      const id = slug(g.id || g.term);
      if (!id || glossary[id] || !g.term) return;
      const aliases = [g.term, ...(g.aliases || [])].map((a) => String(a).toLowerCase().trim()).filter(Boolean);
      glossary[id] = { term: g.term, aliases: [...new Set(aliases)], context: g.context || "", plain: g.plain || "", related: (g.related || []).map(slug) };
    });
    Object.entries(glossary).forEach(([id, g]) => { g.related = [...new Set(g.related)].filter((r) => r !== id && glossary[r]); });

    const links = (s) => String(s || "").replace(/\{\{([^|}]+)\|([^}]+)\}\}/g, (m, text, id) => (glossary[slug(id)] ? `{{${text}|${slug(id)}}}` : text));

    const chapters = (raw.chapters || [])
      .filter((c) => c && c.title && c.body && c.body.length)
      .map((c, i) => ({
        id: `c${i + 1}-${slug(c.id || c.title).slice(0, 28)}`,
        title: c.title,
        section: c.section || "",
        kicker: c.kicker || "",
        body: c.body.map(links),
        analogy: { title: c.analogy_title || "", text: c.analogy_text || "" },
        svg: c.doodle_svg || "",
        caption: c.doodle_caption || "",
        quote: c.quote_text ? { text: c.quote_text, where: c.quote_where || "" } : null,
        takeaways: c.takeaways || [],
      }));
    if (!chapters.length) throw new Error("The explainer came back without any chapters. Try again, or try a different PDF.");

    const quiz = (raw.quiz || [])
      .filter((q) => q && q.question && q.options && q.options.length >= 2 && q.answer_index >= 0 && q.answer_index < q.options.length)
      .map((q) => ({ q: q.question, options: q.options, answer: q.answer_index, why: q.why || "" }));

    const title = raw.title || fileName.replace(/\.pdf$/i, "");
    const hash = [...title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const [bg, fg] = SPINES[hash % SPINES.length];

    return {
      id: `${slug(title).slice(0, 36) || "paper"}-${Date.now().toString(36)}`,
      title,
      subtitle: raw.subtitle || "",
      author: raw.authors || "",
      venue: raw.venue || "",
      year: raw.year || "",
      cite: raw.citation || "",
      doi: (raw.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
      minutes: raw.reading_minutes || Math.max(5, chapters.length * 2),
      breath: raw.one_breath || "",
      spine: { bg, fg, mark: (raw.spine_mark || "").slice(0, 8) },
      chapters,
      quiz,
      glossary,
      fileName,
      addedAt: Date.now(),
      usage,
    };
  }

  /* Starts a run. Returns { done: Promise<paper>, abort() }. onProgress gets { phase, detail, chars, elapsed }. */
  PA.generate = function ({ engine, model, file, onProgress }) {
    const bad = !file || !/\.pdf$/i.test(file.name) && file.type !== "application/pdf" ? "Please choose a PDF file."
      : file.size > 40 * 1024 * 1024 ? "That PDF is over 40 MB. Try a smaller copy." : "";
    if (bad) return { done: Promise.reject(new Error(bad)), abort() {} };
    if (engine === "browser") {
      const run = PA.browserModel.run({ model, file, onProgress });
      return { done: run.done.then(({ result, usage }) => normalize(result, file.name, usage)), abort: run.abort };
    }

    let jobId = null, stopped = false;
    const stop = () => new DOMException("Stopped", "AbortError");

    const done = (async () => {
      onProgress({ phase: "starting" });
      const q = new URLSearchParams({ engine, model: model || "", name: file.name });
      ({ id: jobId } = await api("/api/jobs?" + q, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file }));
      if (stopped) { cancel(); throw stop(); }
      for (;;) {
        await sleep(1200);
        if (stopped) throw stop();
        const job = await api("/api/jobs/" + jobId);
        onProgress(job);
        if (job.status === "done") return normalize(job.result, file.name, { ...job.usage, seconds: job.elapsed });
        if (job.status === "error") throw new Error(job.error);
        if (job.status === "cancelled") throw stop();
      }
    })();

    const cancel = () => jobId && api(`/api/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => {});
    return { done, abort() { stopped = true; cancel(); } };
  };

  PA.explainError = async (err) => (err && err.name === "AbortError" ? "Stopped. Nothing was saved." : (err && err.message) || "Something went wrong.");
  PA.normalizePaper = normalize;
})();
