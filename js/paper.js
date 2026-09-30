/* Renders one paper (paper.html?id=…) from this device's storage.
   All text was written by a model from an uploaded file, so it is escaped before display. */
(async function () {
  const app = document.getElementById("app");
  const id = new URLSearchParams(location.search).get("id");
  const esc = PA.esc;
  const pad = (n) => String(n).padStart(2, "0");

  const all = await PA.store.all();
  const p = all.find((x) => x.id === id);
  if (!p) {
    app.innerHTML = `<section class="section"><h1 class="section-title">Blank tape</h1>
      <p class="section-lede" style="margin-top:16px">This paper isn’t on this device. Papers you didn’t keep disappear when the tab closes.
      <a href="index.html#shelf">Back to the shelf</a> or <a href="index.html#new">record a paper</a>.</p></section>`;
    return;
  }
  const num = pad(all.indexOf(p) + 1);
  document.title = `${p.title} · Paper Archive`;

  // **bold**, *italic* and {{shown words|glossary-id}}; everything else is plain text
  const rich = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/\{\{([^|}]+)\|([^}]+)\}\}/g, (m, t, g) => (p.glossary[g] ? `<span class="term" role="button" tabindex="0" data-term="${g}">${t}</span>` : t));
  const short = (g) => p.glossary[g].term.replace(/\s*\(.*\)$/, "");
  const termsIn = (c) => [...new Set([...c.body.join(" ").matchAll(/\{\{[^|}]+\|([^}]+)\}\}/g)].map((m) => m[1]))].filter((g) => p.glossary[g]);
  // Chapters without their own doodle (bad SVG, or the in-browser writer) take turns with the built-in ones.
  const art = (c, i = 0) => PA.safeSVG(c.svg, c.caption) || PA.drawing(["bubble", "bulb", "pencil", "lookup"][i % 4]);
  const tints = ["", "pink", "blue"];
  const tilts = [-1.8, 1.4, -1, 2, -2.2, 1.1, -1.4, 1.7];
  const first = p.chapters[0], last = p.chapters[p.chapters.length - 1];

  const hero = `
    ${p.kept ? "" : `<div class="session-note"><span><b>This session only.</b> This paper disappears when you close the tab.</span><button class="box-btn" data-keep-now>Keep it on this device</button></div>`}
    <header class="p-hero">
      <div>
        <div class="mono p-kicker">Paper № ${num} · explained</div>
        <h1 class="p-title">${esc(p.title)}</h1>
        ${p.subtitle ? `<p class="p-sub">${esc(p.subtitle)}</p>` : ""}
        <div class="p-meta">
          ${p.author ? `<span class="box-btn">${esc(p.author)}</span>` : ""}
          ${p.cite || p.venue ? `<span class="box-btn">${esc(p.cite || [p.venue, p.year].filter(Boolean).join(" · "))}</span>` : ""}
          ${p.doi ? `<a class="box-btn" href="https://doi.org/${encodeURI(p.doi)}" target="_blank" rel="noopener">Original ↗</a>` : ""}
          <span class="box-btn">~${+p.minutes || 10} min · ${p.chapters.length} chapters · ${Object.keys(p.glossary).length} terms</span>
        </div>
      </div>
      <div class="p-scraps" aria-hidden="true">
        ${p.breath ? `<div class="sticky">${esc(p.breath)}<small>the paper in one breath</small></div>` : ""}
        <div class="ticket"><div class="top"><span>Admit one</span><span>№ ${num}</span></div>
          <div>${esc([p.venue, p.year].filter(Boolean).join(" · ") || "Paper Archive")}</div><div class="big">${esc(p.author || p.title)}</div>
          <div>Level: curious → PhD</div><div>Seat: ${esc((first.section || "").split(" ")[0] || "01")}–${esc((last.section || "").split(" ")[0] || pad(p.chapters.length))}</div></div>
        <div class="polaroid"><div class="photo">${art(first)}</div><div class="cap">${esc(first.caption)}</div></div>
      </div>
    </header>
    <div class="how-to">
      <span><b>How to read:</b> tap any <span class="term-demo">underlined word</span> for what it means <em>in this paper</em> · select any other word to look it up · press <span class="kbd box-btn" style="padding:1px 6px">/</span> to search every card</span>
      <label class="switch"><input type="checkbox" id="jargon" checked> underline jargon</label>
    </div>`;

  const stubs = p.chapters
    .map((c, i) => `<a class="stub" href="#ch-${c.id}" data-sec="ch-${c.id}"><b>${pad(i + 1)}</b><span>${esc(c.title)}</span></a>`)
    .join("") +
    `<a class="stub extra" href="#cards" data-sec="cards"><b>✦</b><span>Card catalogue</span></a>` +
    (p.quiz.length ? `<a class="stub extra" href="#quiz" data-sec="quiz"><b>?</b><span>Pop quiz</span></a>` : "");

  const chapters = p.chapters
    .map((c, i) => `
      <section class="chapter" id="ch-${c.id}">
        <div class="ch-head">
          <div class="ch-num" aria-hidden="true">${pad(i + 1)}</div>
          <div class="ch-meta">${c.kicker ? `<span class="mono">${esc(c.kicker)}</span>` : ""}${c.section ? `<span class="chip">${esc(c.section)} in the paper</span>` : ""}</div>
          <h2 class="ch-title">${esc(c.title)}</h2>
        </div>
        <div class="ch-main">
          <div class="prose">${c.body.map((b) => `<p>${rich(b)}</p>`).join("")}</div>
          ${c.quote ? `<blockquote class="quote">“${esc(c.quote.text)}”${c.quote.where ? `<cite>${esc(c.quote.where)}</cite>` : ""}</blockquote>` : ""}
          ${c.takeaways.length ? `<div class="receipt">
            <h5>WHAT YOU JUST LEARNED</h5>
            <ol>${c.takeaways.map((t) => `<li>${rich(t)}</li>`).join("")}</ol>
            ${termsIn(c).length ? `<div class="words">${termsIn(c).map((g) => `<span class="term" role="button" tabindex="0" data-term="${g}">${esc(short(g))}</span>`).join("")}</div>` : ""}
          </div>` : ""}
        </div>
        <aside class="ch-side">
          <figure class="polaroid" style="--r:${-tilts[i % tilts.length]}deg;margin:0"><div class="photo">${art(c, i)}</div><figcaption class="cap">${esc(c.caption)}</figcaption></figure>
          ${c.analogy.text ? `<div class="analogy ${tints[i % 3]}" style="--r:${tilts[i % tilts.length]}deg"><span class="lbl">Think of it like…</span><h4>${esc(c.analogy.title)}</h4><p>${rich(c.analogy.text)}</p></div>` : ""}
        </aside>
      </section>`)
    .join("");

  const cards = `
    <section class="section" id="cards" style="padding-left:0;padding-right:0">
      <div class="gloss-head">
        <h2 class="section-title">Card<br>catalogue</h2>
        <p class="section-lede">Every key term, defined the way <em>this paper</em> uses it, plus an everyday version. Tap a card to see where it shows up.</p>
        <label class="gloss-filter"><span aria-hidden="true">⌕</span><input type="search" placeholder="Filter cards…" aria-label="Filter glossary cards"></label>
      </div>
      <div class="gloss-grid"></div>
    </section>`;

  const quiz = p.quiz.length
    ? `<section class="section" id="quiz" style="padding-left:0;padding-right:0">
        <div class="gloss-head"><h2 class="section-title">Pop<br>quiz</h2><p class="section-lede">${p.quiz.length} questions. No grades, just a check that the ideas stuck.</p><span class="score" aria-live="polite"></span></div>
        <div class="quiz">${p.quiz
          .map((q, i) => `<div class="q" data-q="${i}"><span class="n">Q${i + 1}</span><h4>${esc(q.q)}</h4>${q.options
            .map((o, j) => `<button data-opt="${j}">${esc(o)}</button>`).join("")}<p class="why" hidden>${esc(q.why)}</p></div>`)
          .join("")}</div>
      </section>`
    : "";

  app.innerHTML = hero + `<div class="reader"><nav class="stubs" aria-label="Chapters">${stubs}</nav><div class="chapters">${chapters}${cards}${quiz}</div></div>`;

  /* ---- wire up ---- */
  const lookup = new PA.Lookup(p);

  const keepBtn = document.querySelector("[data-keep-now]");
  if (keepBtn) keepBtn.addEventListener("click", async () => {
    try {
      await PA.store.keep(p);
      document.querySelector(".session-note").innerHTML = `<span><b>Saved on this device.</b> It’ll be on your shelf next time.</span>`;
    } catch (e) {
      alert("This browser wouldn’t save it (private browsing can block storage).");
    }
  });

  const grid = document.querySelector(".gloss-grid");
  const drawCards = (q) => {
    const ids = lookup.search(q || "");
    grid.innerHTML = ids.length
      ? ids.map((g) => `<button class="gcard" data-term="${g}"><b>${esc(p.glossary[g].term)}</b><span>${esc(p.glossary[g].plain)}</span></button>`).join("")
      : `<p class="section-lede">No card matches. Try the <button class="btn-mini" data-open-catalogue>full lookup</button>.</p>`;
  };
  drawCards();
  document.querySelector(".gloss-filter input").addEventListener("input", (e) => drawCards(e.target.value));

  let right = 0, answered = 0;
  document.querySelectorAll(".q").forEach((box) => {
    const q = p.quiz[+box.dataset.q];
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const pick = +b.dataset.opt;
      box.querySelectorAll("button").forEach((x) => { x.disabled = true; if (+x.dataset.opt === q.answer) x.classList.add("right"); });
      if (pick !== q.answer) b.classList.add("wrong"); else right++;
      answered++;
      box.querySelector(".why").hidden = false;
      document.querySelector(".score").textContent = `${right} / ${answered} right${answered === p.quiz.length ? (right === answered ? " · perfect ✦" : " · nice") : ""}`;
    }));
  });

  const jargon = document.getElementById("jargon");
  try { if (localStorage.getItem("pa-clean") === "1") jargon.checked = false; } catch (e) {}
  const applyJargon = () => {
    document.body.classList.toggle("clean", !jargon.checked);
    try { localStorage.setItem("pa-clean", jargon.checked ? "0" : "1"); } catch (e) {}
  };
  jargon.addEventListener("change", applyJargon);
  applyJargon();

  const stubsEl = document.querySelector(".stubs");
  const links = [...document.querySelectorAll(".stub")];
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((l) => l.classList.toggle("on", l.dataset.sec === en.target.id));
      const on = links.find((l) => l.dataset.sec === en.target.id);
      if (on && stubsEl.scrollWidth > stubsEl.clientWidth) stubsEl.scrollTo({ left: on.offsetLeft - 16, behavior: "smooth" });
    });
  }, { rootMargin: "-35% 0px -60% 0px" });
  document.querySelectorAll(".chapter, #cards, #quiz").forEach((s) => io.observe(s));

  const bar = document.querySelector(".progress");
  const onScroll = () => { bar.style.width = (100 * scrollY) / Math.max(1, document.documentElement.scrollHeight - innerHeight) + "%"; };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- download a designed PDF of the paper (js/pdf.js); printing still works too (print styles in style.css) ---- */
  const filter = document.querySelector(".gloss-filter input");
  addEventListener("beforeprint", () => { if (filter.value) { filter.value = ""; drawCards(); } }); // every card, not a filtered few
  const pdfBtn = document.querySelector("[data-pdf]");
  const savePdf = async () => {
    if (pdfBtn.disabled) return;
    pdfBtn.disabled = true;
    pdfBtn.textContent = "Making PDF…";
    try {
      await document.fonts.ready;
      const doodles = p.chapters.map((c) => document.querySelector(`#ch-${CSS.escape(c.id)} .photo svg`));
      await PA.downloadPdf(p, doodles);
    } catch (e) {
      console.error(e);
      alert("Couldn’t make the PDF: " + (e.message || e));
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = "Download PDF";
    }
  };
  pdfBtn.addEventListener("click", savePdf);
  if (new URLSearchParams(location.search).get("pdf") === "1") { // "Download PDF" on the shelf
    history.replaceState(null, "", `paper.html?id=${encodeURIComponent(id)}`);
    savePdf();
  }

  if (location.hash) setTimeout(() => { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }, 60);
})();
