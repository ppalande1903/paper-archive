/* "Download PDF": builds a designed A4 article from a paper (cover, chapters, glossary, quiz) and downloads it.
   It's real text with embedded fonts (fonts/, OFL) and vector doodles, made in the browser with pdfmake,
   which loads only when someone asks for a PDF. Characters the site's fonts don't have (Greek, maths) fall
   back to Noto Serif or Noto Sans Math, which are only fetched when a paper needs them. */
window.PA = window.PA || {};

(function () {
  const PDFMAKE = "https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/pdfmake.min.js";
  const C = { paper: "#f6f0e3", card: "#fbf8f1", ink: "#1b1a18", muted: "#6f6658", faint: "#d9cfbd", red: "#b3141c", pink: "#e9779e", notes: ["#e4c867", "#f5b3cd", "#9fbbee"] };
  const FONTS = {
    Newsreader: ["Newsreader-Regular", "Newsreader-SemiBold", "Newsreader-Italic", "Newsreader-SemiBoldItalic"],
    Instrument: ["InstrumentSerif-Regular", "InstrumentSerif-Regular", "InstrumentSerif-Italic", "InstrumentSerif-Italic"],
    Plex: ["IBMPlexMono-Regular", "IBMPlexMono-SemiBold", "IBMPlexMono-Regular", "IBMPlexMono-SemiBold"],
    Caveat: ["Caveat-SemiBold", "Caveat-SemiBold", "Caveat-SemiBold", "Caveat-SemiBold"],
    NotoSerif: ["NotoSerif-Regular", "NotoSerif-Regular", "NotoSerif-Regular", "NotoSerif-Regular"],
    NotoMath: ["NotoSansMath-Regular", "NotoSansMath-Regular", "NotoSansMath-Regular", "NotoSansMath-Regular"],
  };
  const FALLBACKS = ["NotoSerif", "NotoMath"];

  let ready = null; // loads pdfmake and the font coverage table once
  function load() {
    return (ready = ready || Promise.all([
      new Promise((resolve, reject) => {
        if (window.pdfMake) return resolve();
        const s = document.createElement("script");
        s.src = PDFMAKE;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Couldn’t load the PDF maker. Check your connection and try again."));
        document.head.append(s);
      }),
      fetch("fonts/coverage.json").then((r) => r.json()),
    ]).then(([, coverage]) => coverage).catch((e) => { ready = null; throw e; }));
  }

  /* ---------- text: markup, glyph fallback ---------- */

  let coverage = {}, needed = new Set();
  const covers = (font, cp) => {
    const ranges = coverage[font] || [];
    let lo = 0, hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, [a, b] = ranges[mid];
      if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else return true;
    }
    return false;
  };

  /* Splits a run so each piece uses a font that has its characters. A run without its own font inherits one
     (from its node, or `inherit` for checking); only its fallback pieces get a font of their own. */
  function fit(run, inherit = "Newsreader") {
    const font = run.font || inherit;
    const out = [];
    let cur = null;
    for (const ch of run.text) {
      const cp = ch.codePointAt(0);
      const f = cp < 0x80 || /\s/.test(ch) || covers(font, cp) ? font : FALLBACKS.find((x) => covers(x, cp)) || font;
      if (f !== font) needed.add(f);
      if (cur && cur.f === f) cur.text += ch;
      else out.push((cur = { ...run, text: ch, f }));
    }
    return out.map(({ f, ...r }) => (f !== font || run.font ? { ...r, font: f } : r));
  }
  const t = (text, style = {}) => fit({ text: String(text ?? ""), ...style });
  /* A heading that the contents list can restyle: its font is on the node, not on the text. */
  const heading = (text, font, fontSize, extra = {}) => ({
    text: fit({ text: String(text ?? "") }, font), font, fontSize, lineHeight: 0.95,
    tocItem: true, tocStyle: { font: "Newsreader", fontSize: 12.5, lineHeight: 1.2 }, tocMargin: [0, 0, 0, 5], ...extra,
  });

  /* The site's markup: **bold**, *italic* and {{shown words|glossary-id}} (underlined like on the page). */
  function rich(s, base = {}) {
    const runs = [];
    const re = /\*\*(.+?)\*\*|\*(?!\s)(.+?)\*|\{\{([^|}]+)\|[^}]+\}\}/g;
    let last = 0, m;
    s = String(s || "");
    while ((m = re.exec(s))) {
      if (m.index > last) runs.push(...t(s.slice(last, m.index), base));
      if (m[1]) runs.push(...t(m[1], { ...base, bold: true }));
      else if (m[2]) runs.push(...t(m[2], { ...base, italics: true }));
      else runs.push(...t(m[3], { ...base, decoration: "underline", decorationStyle: "dashed", decorationColor: C.pink }));
      last = re.lastIndex;
    }
    if (last < s.length) runs.push(...t(s.slice(last), base));
    return runs;
  }

  /* ---------- doodles: the page's own SVGs, with their CSS turned into plain attributes ---------- */

  const PROPS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-weight", "text-anchor"];
  function doodle(svg) {
    if (!svg) return null;
    const copy = svg.cloneNode(true);
    const live = [svg, ...svg.querySelectorAll("*")], dead = [copy, ...copy.querySelectorAll("*")];
    live.forEach((el, i) => {
      const cs = getComputedStyle(el), d = dead[i];
      d.removeAttribute("class");
      d.removeAttribute("style");
      d.removeAttribute("filter");
      for (const p of PROPS) {
        const v = cs.getPropertyValue(p);
        if (v && v !== "normal" && !(p === "stroke-dasharray" && v === "none")) d.setAttribute(p, p === "font-size" ? parseFloat(v) : v);
      }
      if (/^(text|tspan)$/.test(el.tagName)) d.setAttribute("font-family", "Caveat");
    });
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!copy.getAttribute("viewBox")) copy.setAttribute("viewBox", "0 0 320 240");
    return new XMLSerializer().serializeToString(copy);
  }

  /* ---------- pieces ---------- */

  const W = 595.28 - 2 * 56; // A4 width minus margins
  const label = (text, color = C.muted, margin = [0, 0, 0, 0]) => ({ text: t(text, { font: "Plex", fontSize: 6.8, characterSpacing: 1.1, color }), margin });
  const box = (content, fill, pad = [12, 10, 12, 12]) => ({
    table: { widths: ["*"], body: [[{ stack: content, fillColor: fill }]] },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => pad[0], paddingTop: () => pad[1], paddingRight: () => pad[2], paddingBottom: () => pad[3] },
  });

  function polaroid(svg, caption, width) {
    if (!svg) return { text: "" };
    return box([
      { svg, width: width - 16 },
      { text: t(caption || "", { font: "Caveat", fontSize: 12, color: "#2b3f8f" }), margin: [2, 4, 0, 0] },
    ], "#ffffff", [8, 8, 8, 6]);
  }

  function chapter(p, c, i, svg) {
    const note = C.notes[i % 3];
    const side = [];
    if (svg) side.push({ width: 168, stack: [polaroid(svg, c.caption, 168)] });
    if (c.analogy.text) side.push({ width: "*", stack: [box([
      label("THINK OF IT LIKE…", "#5a4f3c"),
      { text: t(c.analogy.title, { font: "Caveat", fontSize: 17, color: C.ink }), margin: [0, 3, 0, 4] },
      { text: rich(c.analogy.text, { fontSize: 10, color: C.ink }) },
    ], note)] });
    const terms = [...new Set([...c.body.join(" ").matchAll(/\{\{[^|}]+\|([^}]+)\}\}/g)].map((m) => m[1]))].filter((g) => p.glossary[g]);
    return [
      {
        columns: [
          { width: "auto", text: t(String(i + 1).padStart(2, "0"), { font: "Instrument", fontSize: 58, color: C.faint, lineHeight: 0.8 }) },
          { width: "*", margin: [12, 6, 0, 0], stack: [
            label([c.kicker, c.section && `${c.section} in the paper`].filter(Boolean).join("  ·  ").toUpperCase(), C.red),
            heading(c.title, "Instrument", 27, { margin: [0, 4, 0, 0] }),
          ] },
        ],
        pageBreak: "before",
        margin: [0, 0, 0, 16],
      },
      ...c.body.map((b) => ({ text: rich(b), margin: [0, 0, 0, 8] })),
      c.quote && { margin: [0, 6, 0, 14], unbreakable: true, table: { widths: [2, "*"], body: [[
        { text: "", fillColor: C.pink },
        { stack: [{ text: rich(`“${c.quote.text}”`, { italics: true, fontSize: 11 }) }, c.quote.where && label(c.quote.where.toUpperCase(), C.muted, [0, 5, 0, 0])].filter(Boolean) },
      ]] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: (j) => (j ? 12 : 0), paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2 } },
      side.length && { columns: side, columnGap: 16, margin: [0, 4, 0, 16], unbreakable: true },
      c.takeaways.length && { unbreakable: true, margin: [0, 2, 0, 0], ...box([
        { text: t("WHAT YOU JUST LEARNED", { font: "Plex", bold: true, fontSize: 7.5, characterSpacing: 1.4 }), alignment: "center", margin: [0, 0, 0, 6] },
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: W - 24, y2: 0, dash: { length: 2 }, lineColor: "#999" }], margin: [0, 0, 0, 6] },
        { ol: c.takeaways.map((x) => ({ text: rich(x, { font: "Plex", fontSize: 8.5 }), margin: [0, 0, 0, 3] })), font: "Plex", fontSize: 8.5 },
        terms.length && { text: [...t("KEY TERMS  ", { font: "Plex", fontSize: 7, color: C.muted, characterSpacing: 1 }),
          ...t(terms.map((g) => p.glossary[g].term).join("  ·  "), { font: "Plex", fontSize: 8 })], margin: [0, 6, 0, 0] },
      ].filter(Boolean), C.card) },
    ].filter(Boolean);
  }

  function build(p, svgs) {
    const meta = [p.author, [p.venue, p.year].filter(Boolean).join(" ")].filter(Boolean).join("  ·  ");
    const terms = Object.keys(p.glossary).sort((a, b) => p.glossary[a].term.localeCompare(p.glossary[b].term));
    const cover = [
      label("PAPER ARCHIVE  ·  EXPLAINED", C.red, [0, 10, 0, 10]),
      { text: t(p.title, { font: "Instrument", fontSize: 44, lineHeight: 0.92 }), margin: [0, 0, 0, 8] },
      p.subtitle && { text: t(p.subtitle, { font: "Instrument", italics: true, fontSize: 17, color: C.muted }), margin: [0, 0, 0, 10] },
      meta && { text: t(meta, { font: "Plex", fontSize: 8, color: C.muted }), margin: [0, 0, 0, 4] },
      p.doi && { text: t(`doi.org/${p.doi}`, { font: "Plex", fontSize: 8, color: C.red }), link: `https://doi.org/${p.doi}`, margin: [0, 0, 0, 4] },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: W, y2: 0, lineWidth: 0.6, lineColor: C.faint }], margin: [0, 10, 0, 18] },
      { columns: [
        p.breath ? { width: "*", stack: [box([
          label("THE PAPER IN ONE BREATH", "#5a4f3c"),
          { text: t(p.breath, { font: "Caveat", fontSize: 17, lineHeight: 1.05 }), margin: [0, 5, 0, 0] },
        ], C.notes[0], [14, 12, 14, 14])] } : { width: "*", text: "" },
        svgs[0] ? { width: 176, stack: [polaroid(svgs[0], p.chapters[0].caption, 176)] } : { width: 0, text: "" },
      ], columnGap: 20, margin: [0, 0, 0, 18] },
      { text: t(`~${+p.minutes || 10} min read  ·  ${p.chapters.length} chapters  ·  ${terms.length} terms  ·  ${p.quiz.length} quiz questions`, { font: "Plex", fontSize: 8, color: C.muted }), margin: [0, 0, 0, 20] },
      { toc: { title: { text: t("IN THIS TAPE", { font: "Plex", fontSize: 7.5, characterSpacing: 1.4, color: C.red }), margin: [0, 0, 0, 8] }, numberStyle: { font: "Plex", fontSize: 9 } } },
    ].filter(Boolean);

    const glossary = [
      heading("Card catalogue", "Instrument", 32, { pageBreak: "before", margin: [0, 0, 0, 6] }),
      { text: t("Every key term, defined the way this paper uses it, plus an everyday version.", { italics: true, color: C.muted }), margin: [0, 0, 0, 14] },
      { table: { widths: [120, "*"], dontBreakRows: true, body: terms.map((g) => {
        const e = p.glossary[g];
        return [
          { text: t(e.term, { font: "Instrument", fontSize: 14, lineHeight: 1 }) },
          { stack: [{ text: rich(e.context, { fontSize: 9.8 }) }, e.plain && { text: [...t("In plain words: ", { font: "Plex", fontSize: 7.2, color: C.muted }), ...rich(e.plain, { italics: true, fontSize: 9.8, color: C.muted })], margin: [0, 3, 0, 0] }].filter(Boolean) },
        ];
      }) }, layout: { hLineWidth: (i) => (i === 0 ? 0 : 0.5), hLineColor: () => C.faint, vLineWidth: () => 0, paddingTop: () => 8, paddingBottom: () => 8, paddingLeft: () => 0, paddingRight: (i) => (i === 0 ? 12 : 0) } },
    ];

    const letters = "ABCD";
    const quiz = p.quiz.length ? [
      heading("Pop quiz", "Instrument", 32, { pageBreak: "before", margin: [0, 0, 0, 6] }),
      { text: t(`${p.quiz.length} questions. No grades, just a check that the ideas stuck. Answers at the end.`, { italics: true, color: C.muted }), margin: [0, 0, 0, 14] },
      ...p.quiz.map((q, i) => ({ unbreakable: true, margin: [0, 0, 0, 14], stack: [
        { text: [...t(`Q${i + 1}  `, { font: "Plex", fontSize: 8, color: C.red }), ...rich(q.q, { bold: true, fontSize: 11 })], margin: [0, 0, 0, 5] },
        ...q.options.map((o, j) => ({ text: [...t(`${letters[j] || j + 1}   `, { font: "Plex", fontSize: 8.5, color: C.muted }), ...rich(o)], margin: [14, 0, 0, 3] })),
      ] })),
      { unbreakable: true, margin: [0, 10, 0, 0], ...box([
        label("ANSWER KEY", C.muted, [0, 0, 0, 6]),
        ...p.quiz.map((q, i) => ({ text: [...t(`Q${i + 1}  ${letters[q.answer] || q.answer + 1}   `, { font: "Plex", fontSize: 8.5, bold: true }), ...rich(q.why, { fontSize: 9.5 })], margin: [0, 0, 0, 4] })),
      ], C.card) },
    ] : [];

    return {
      pageSize: "A4",
      pageMargins: [56, 60, 56, 64],
      info: { title: p.title, author: p.author || "", subject: "Paper Archive explainer", creator: "Paper Archive" },
      background: () => ({ canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 841.89, color: C.paper }] }),
      footer: (page, pages) => ({
        margin: [56, 24, 56, 0],
        columns: page === 1
          ? [{ text: t("An AI-written retelling of the paper. Check the original before citing anything.", { font: "Plex", fontSize: 6.8, color: C.muted }) }]
          : [{ text: t(`${p.title.length > 70 ? p.title.slice(0, 69) + "…" : p.title}`, { font: "Plex", fontSize: 6.8, color: C.muted }) },
             { width: "auto", text: t(`${page} / ${pages}`, { font: "Plex", fontSize: 6.8, color: C.muted }) }],
      }),
      defaultStyle: { font: "Newsreader", fontSize: 10.6, lineHeight: 1.36, color: C.ink },
      content: [...cover, ...p.chapters.flatMap((c, i) => chapter(p, c, i, svgs[i])), ...glossary, ...quiz],
    };
  }

  const fileName = (title) => (String(title || "paper").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "paper") + ".pdf";

  /* Builds the PDF for a paper and downloads it. `svgs` are the chapters' doodles as drawn on the page. */
  PA.downloadPdf = async function (paper, svgEls) {
    coverage = await load();
    needed = new Set();
    const doc = build(paper, svgEls.map(doodle));
    const url = (f) => new URL(`fonts/${f}.ttf`, location.href).href;
    const fonts = {};
    for (const [name, files] of Object.entries(FONTS)) {
      if (FALLBACKS.includes(name) && !needed.has(name)) continue; // only fetch a fallback when this paper needs it
      fonts[name] = { normal: url(files[0]), bold: url(files[1]), italics: url(files[2]), bolditalics: url(files[3]) };
    }
    pdfMake.fonts = fonts;
    await pdfMake.createPdf(doc).download(fileName(paper.title));
  };
})();
