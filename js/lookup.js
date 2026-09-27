/* In-context lookup: term cards, "select any word → Look up", and the searchable card catalogue.
   Everything is answered from the paper's own glossary first; Wikipedia is only an opt-in fallback. */
window.PA = window.PA || {};

(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function singular(w) {
    if (w.length <= 3) return w;
    if (w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (/(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
    if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function norm(s) {
    return String(s)
      .toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[-–—/&]/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(singular)
      .join(" ");
  }

  const stripMarkup = (s) => s.replace(/\{\{([^|}]+)\|[^}]+\}\}/g, "$1").replace(/\*+/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  function Lookup(paper) {
    this.paper = paper;
    this.ids = Object.keys(paper.glossary);
    this.entries = this.ids.map((id) => {
      const g = paper.glossary[id];
      return { id, g, keys: [...new Set([norm(g.term), ...g.aliases.map(norm)])].filter((k) => k.length >= 2) };
    });
    this.appears = {};
    this.plain = paper.chapters.map((c) => ({ id: c.id, title: c.title, text: stripMarkup(c.body.join(" ")) }));
    paper.chapters.forEach((c) => {
      for (const m of c.body.join(" ").matchAll(/\{\{[^|}]+\|([^}]+)\}\}/g)) {
        (this.appears[m[1]] = this.appears[m[1]] || new Set()).add(c.id);
      }
    });
    this.number = Object.fromEntries(
      [...this.ids].sort((a, b) => paper.glossary[a].term.localeCompare(paper.glossary[b].term)).map((id, i) => [id, i + 1])
    );
    this.build();
  }

  Lookup.prototype.find = function (query) {
    const q = norm(query);
    if (!q) return null;
    const pad = " " + q + " ";
    let best = null, bestLen = 0;
    for (const e of this.entries) {
      if (e.keys.includes(q)) return e.id;
      for (const k of e.keys) {
        if (k.length >= 3 && pad.includes(" " + k + " ") && k.length > bestLen) { best = e.id; bestLen = k.length; }
      }
    }
    if (best) return best;
    if (q.length >= 4) {
      for (const e of this.entries) for (const k of e.keys) {
        if (k.startsWith(q) && (!best || k.length < bestLen)) { best = e.id; bestLen = k.length; }
      }
    }
    return best;
  };

  Lookup.prototype.search = function (query) {
    const q = norm(query);
    const all = this.entries.slice().sort((a, b) => a.g.term.localeCompare(b.g.term));
    if (!q) return all.map((e) => e.id);
    return all
      .map((e) => {
        let s = 0;
        if (e.keys.includes(q)) s = 100;
        else if (e.keys.some((k) => k.startsWith(q))) s = 70;
        else if (e.keys.some((k) => k.includes(q) || q.includes(k))) s = 50;
        else if (norm(e.g.context + " " + e.g.plain).includes(q)) s = 15;
        return [e.id, s];
      })
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  };

  Lookup.prototype.occurrences = function (query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return this.plain
      .map((c) => {
        const i = c.text.toLowerCase().indexOf(q);
        if (i < 0) return null;
        const a = Math.max(0, i - 70), b = Math.min(c.text.length, i + q.length + 70);
        return { id: c.id, title: c.title, before: (a ? "…" : "") + c.text.slice(a, i), hit: c.text.slice(i, i + q.length), after: c.text.slice(i + q.length, b) + (b < c.text.length ? "…" : "") };
      })
      .filter(Boolean);
  };

  /* ---------- markup ---------- */

  Lookup.prototype.cardHTML = function (id) {
    const g = this.paper.glossary[id];
    const where = [...(this.appears[id] || [])]
      .map((cid) => { const i = this.paper.chapters.findIndex((c) => c.id === cid); return `<a class="chip" href="#ch-${cid}" data-close>Ch ${String(i + 1).padStart(2, "0")}</a>`; })
      .join("");
    const rel = (g.related || []).map((r) => `<button class="chip" data-open-term="${r}">${esc(this.paper.glossary[r].term.replace(/\s*\(.*\)$/, ""))}</button>`).join("");
    return `
      <div class="idx-kicker"><span>INDEX CARD</span><span>№ ${String(this.number[id]).padStart(2, "0")}</span></div>
      <h3 class="idx-term">${esc(g.term)}</h3>
      <div class="idx-block"><span class="idx-label">In this paper</span><p>${esc(g.context)}</p></div>
      <div class="idx-block plain"><span class="idx-label">In plain words</span><p>${esc(g.plain)}</p></div>
      ${where ? `<div class="idx-row"><span class="idx-label">Shows up in</span><div class="chips">${where}</div></div>` : ""}
      ${rel ? `<div class="idx-row"><span class="idx-label">See also</span><div class="chips">${rel}</div></div>` : ""}`;
  };

  Lookup.prototype.unknownHTML = function (query) {
    const hits = this.occurrences(query);
    const list = hits.length
      ? `<div class="idx-block"><span class="idx-label">Where it shows up here</span>${hits
          .map((h) => `<a class="snip" href="#ch-${h.id}" data-close><b>${esc(h.title)}</b><span>${esc(h.before)}<mark>${esc(h.hit)}</mark>${esc(h.after)}</span></a>`)
          .join("")}</div>`
      : "";
    return `
      <div class="idx-kicker"><span>NO CARD YET</span><span>№ —</span></div>
      <h3 class="idx-term">“${esc(query)}”</h3>
      <p class="idx-note">This isn’t one of the paper’s ${this.ids.length} key terms, so there’s no paper-specific meaning for it.</p>
      ${list}
      <div class="idx-block wiki" data-wiki="${esc(query)}">
        <button class="btn-mini" data-wiki-go>Get the general meaning (Wikipedia) ↗</button>
      </div>`;
  };

  Lookup.prototype.loadWiki = async function (box) {
    const q = box.dataset.wiki.trim();
    box.innerHTML = `<span class="idx-label">General meaning</span><p class="muted">Looking it up…</p>`;
    const title = q.charAt(0).toUpperCase() + q.slice(1);
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const text = d.type === "disambiguation" ? "That word has several meanings on Wikipedia. Try a more specific phrase." : d.extract;
      box.innerHTML = `<span class="idx-label">General meaning · Wikipedia</span><p>${esc(text)}</p>
        <p class="idx-note">This is the everyday meaning, not necessarily how the paper uses it.</p>
        ${d.content_urls ? `<a class="btn-mini" href="${esc(d.content_urls.desktop.page)}" target="_blank" rel="noopener">Read on Wikipedia ↗</a>` : ""}`;
    } catch (e) {
      box.innerHTML = `<span class="idx-label">General meaning</span><p class="muted">Couldn’t find a Wikipedia page for “${esc(q)}”. Try selecting fewer words.</p>`;
    }
  };

  /* ---------- UI ---------- */

  Lookup.prototype.build = function () {
    this.card = document.createElement("div");
    this.card.className = "idx-card";
    this.card.setAttribute("role", "dialog");
    this.card.hidden = true;
    document.body.appendChild(this.card);

    this.pill = document.createElement("button");
    this.pill.className = "lookup-pill";
    this.pill.hidden = true;
    document.body.appendChild(this.pill);

    this.cat = document.createElement("div");
    this.cat.className = "catalogue";
    this.cat.hidden = true;
    this.cat.innerHTML = `
      <div class="cat-panel" role="dialog" aria-modal="true" aria-label="Card catalogue: look up a word">
        <div class="cat-head"><span>CARD CATALOGUE · ${this.ids.length} CARDS</span><button class="box-btn" data-cat-close>ESC</button></div>
        <label class="cat-input"><span aria-hidden="true">⌕</span><input type="search" placeholder="Type any word from the paper…" autocomplete="off" spellcheck="false" aria-label="Search terms"></label>
        <div class="cat-body"></div>
      </div>`;
    document.body.appendChild(this.cat);
    this.input = this.cat.querySelector("input");
    this.catBody = this.cat.querySelector(".cat-body");

    const self = this;

    document.addEventListener("click", (ev) => {
      const t = ev.target;
      const term = t.closest("[data-term]");
      if (term) { ev.preventDefault(); self.open(term.dataset.term, term); return; }
      const rel = t.closest("[data-open-term]");
      if (rel) {
        if (self.cat.contains(rel)) self.showInCatalogue(rel.dataset.openTerm);
        else self.open(rel.dataset.openTerm, self.anchor);
        return;
      }
      if (t.closest("[data-wiki-go]")) { self.loadWiki(t.closest("[data-wiki]")); return; }
      if (t.closest("[data-close]")) { self.close(); self.closeCatalogue(); return; }
      if (t.closest("[data-cat-close]") || t === self.cat) { self.closeCatalogue(); return; }
      if (t.closest("[data-cat-back]")) { self.renderResults(); self.input.focus(); return; }
      const res = t.closest("[data-result]");
      if (res) { self.showInCatalogue(res.dataset.result); return; }
      if (t.closest("[data-cat-unknown]")) { self.catBody.innerHTML = `<button class="box-btn" data-cat-back>← all cards</button><div class="idx-card flat">${self.unknownHTML(self.input.value)}</div>`; return; }
      if (t.closest("[data-open-catalogue]")) { ev.preventDefault(); self.openCatalogue(); return; }
      if (!self.card.hidden && !self.card.contains(t) && t !== self.pill) self.close();
    });

    document.addEventListener("keydown", (ev) => {
      const typing = /input|textarea|select/i.test(document.activeElement.tagName);
      if ((ev.key === "/" && !typing) || (ev.key.toLowerCase() === "k" && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); self.openCatalogue(); }
      else if (ev.key === "Escape") { self.close(); self.closeCatalogue(); self.hidePill(); }
      else if (ev.key === "Enter" && document.activeElement.classList.contains("term")) { self.open(document.activeElement.dataset.term, document.activeElement); }
    });

    this.input.addEventListener("input", () => self.renderResults());
    this.input.addEventListener("keydown", (ev) => {
      const items = [...self.catBody.querySelectorAll("[data-result]")];
      if (!items.length) return;
      let i = items.indexOf(self.catBody.querySelector(".active"));
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        i = ev.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
        items.forEach((el) => el.classList.remove("active"));
        items[i].classList.add("active");
        items[i].scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter") {
        self.showInCatalogue((items[i] || items[0]).dataset.result);
      }
    });

    // select any word → Look up
    let timer;
    const onSel = () => { clearTimeout(timer); timer = setTimeout(() => self.checkSelection(), 220); };
    document.addEventListener("selectionchange", onSel);
    this.pill.addEventListener("mousedown", (ev) => ev.preventDefault());
    this.pill.addEventListener("click", () => {
      const q = self.pillQuery;
      self.hidePill();
      const id = self.find(q);
      if (id) self.open(id, self.pillRect);
      else self.openUnknown(q, self.pillRect);
      window.getSelection().removeAllRanges();
    });
    window.addEventListener("resize", () => { self.close(); self.hidePill(); });
  };

  Lookup.prototype.checkSelection = function () {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, " ").trim() : "";
    const node = sel && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (!text || text.length < 2 || text.length > 60 || !node || node.closest("input, textarea, .idx-card, .catalogue, .quiz")) return this.hidePill();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return this.hidePill();
    this.pillQuery = text;
    this.pillRect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    const found = this.find(text);
    this.pill.innerHTML = found
      ? `<span>Look up</span> <b>${esc(this.paper.glossary[found].term.replace(/\s*\(.*\)$/, ""))}</b>`
      : `<span>Look up</span> <b>“${esc(text.length > 24 ? text.slice(0, 24) + "…" : text)}”</b>`;
    this.pill.hidden = false;
    const pw = this.pill.offsetWidth;
    const x = Math.min(window.innerWidth - pw - 12, Math.max(12, r.left + r.width / 2 - pw / 2));
    const below = r.bottom + 10 + 40 < window.innerHeight;
    this.pill.style.left = x + window.scrollX + "px";
    this.pill.style.top = (below ? r.bottom + 10 : r.top - 48) + window.scrollY + "px";
  };

  Lookup.prototype.hidePill = function () { this.pill.hidden = true; };

  Lookup.prototype.place = function (anchor) {
    const c = this.card;
    const mobile = window.innerWidth < 700;
    c.classList.toggle("sheet", mobile);
    if (mobile) { c.style.left = c.style.top = ""; return; }
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor || { left: window.innerWidth / 2 - 180, top: 120, bottom: 120, width: 0 };
    const w = c.offsetWidth, h = c.offsetHeight;
    const x = Math.min(window.innerWidth - w - 16, Math.max(16, r.left + (r.width || 0) / 2 - w / 2));
    let y = r.bottom + 12;
    if (y + h > window.innerHeight - 12 && r.top - h - 12 > 12) y = r.top - h - 12;
    c.style.left = x + window.scrollX + "px";
    c.style.top = y + window.scrollY + "px";
  };

  Lookup.prototype.open = function (id, anchor) {
    if (!this.paper.glossary[id]) return;
    this.anchor = anchor;
    this.card.innerHTML = `<button class="idx-close" aria-label="Close card" data-close>×</button>` + this.cardHTML(id);
    this.card.setAttribute("aria-label", this.paper.glossary[id].term);
    this.card.hidden = false;
    this.place(anchor);
  };

  Lookup.prototype.openUnknown = function (query, anchor) {
    this.anchor = anchor;
    this.card.innerHTML = `<button class="idx-close" aria-label="Close card" data-close>×</button>` + this.unknownHTML(query);
    this.card.setAttribute("aria-label", "Look up " + query);
    this.card.hidden = false;
    this.place(anchor);
  };

  Lookup.prototype.close = function () { this.card.hidden = true; };

  Lookup.prototype.openCatalogue = function (q) {
    this.close();
    this.hidePill();
    this.cat.hidden = false;
    document.body.classList.add("no-scroll");
    if (typeof q === "string") this.input.value = q;
    this.renderResults();
    setTimeout(() => this.input.focus(), 30);
  };

  Lookup.prototype.closeCatalogue = function () {
    if (this.cat.hidden) return;
    this.cat.hidden = true;
    document.body.classList.remove("no-scroll");
  };

  Lookup.prototype.renderResults = function () {
    const q = this.input.value.trim();
    const ids = this.search(q);
    if (!ids.length) {
      this.catBody.innerHTML = `<p class="cat-empty">No card for “${esc(q)}”.</p><button class="box-btn" data-cat-unknown>Search the paper &amp; the general meaning →</button>`;
      return;
    }
    this.catBody.innerHTML = `<ul class="cat-list">${ids
      .map((id, i) => {
        const g = this.paper.glossary[id];
        return `<li><button data-result="${id}" class="${i === 0 && q ? "active" : ""}"><span class="cat-no">${String(this.number[id]).padStart(2, "0")}</span><span class="cat-term">${esc(g.term)}</span><span class="cat-plain">${esc(g.plain)}</span></button></li>`;
      })
      .join("")}</ul>`;
  };

  Lookup.prototype.showInCatalogue = function (id) {
    this.catBody.innerHTML = `<button class="box-btn" data-cat-back>← all cards</button><div class="idx-card flat">${this.cardHTML(id)}</div>`;
  };

  PA.Lookup = Lookup;
  PA.esc = esc;
})();
