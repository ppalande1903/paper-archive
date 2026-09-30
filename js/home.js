/* Home: collage scraps, the VHS shelf, the "add a paper" dialog and the on-this-device panel. */
(function () {
  const esc = PA.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // pressed flowers
  document.querySelectorAll(".flower").forEach((svg) => {
    const petals = Array.from({ length: 5 }, (_, i) =>
      `<ellipse cx="0" cy="-26" rx="17" ry="27" transform="rotate(${i * 72})" fill="${svg.dataset.color}" stroke="rgba(0,0,0,.18)" stroke-width="1"/>
       <path d="M0 -8 L0 -44" transform="rotate(${i * 72})" stroke="rgba(0,0,0,.12)" stroke-width="1"/>`).join("");
    svg.innerHTML = petals + `<circle r="11" fill="${svg.dataset.core}"/><circle r="11" fill="none" stroke="rgba(0,0,0,.2)" stroke-dasharray="2 3"/>`;
  });

  // crossword
  document.querySelectorAll(".crossword").forEach((el) => {
    el.innerHTML = el.dataset.grid.split("|").join("").split("")
      .map((ch) => (ch === "#" ? '<span class="x"></span>' : `<span>${ch === "." ? "" : ch}</span>`)).join("");
  });

  document.querySelectorAll("[data-draw]").forEach((el) => (el.innerHTML = PA.drawing(el.dataset.draw)));

  // drag the scraps around (mouse / pen only, so touch users can still scroll the page)
  if (matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll(".scrap").forEach((el) => {
      let sx, sy, ox, oy, pid = null, moved = false;
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        pid = e.pointerId; moved = false;
        el.setPointerCapture(pid);
        sx = e.clientX; sy = e.clientY;
        ox = parseFloat(el.style.getPropertyValue("--dx")) || 0;
        oy = parseFloat(el.style.getPropertyValue("--dy")) || 0;
        el.classList.add("dragging");
      });
      el.addEventListener("pointermove", (e) => {
        if (e.pointerId !== pid) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        el.style.setProperty("--dx", ox + dx + "px");
        el.style.setProperty("--dy", oy + dy + "px");
      });
      const end = (e) => { if (e.pointerId !== pid) return; pid = null; el.classList.remove("dragging"); el.dataset.moved = moved ? "1" : ""; };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      el.addEventListener("click", (e) => { if (el.dataset.moved) { e.preventDefault(); e.stopImmediatePropagation(); el.dataset.moved = ""; } }, true);
    });
  }

  /* ---------- shelf ---------- */
  const BLANKS = [
    ["#1b2f6b", "#e8e0cc", "T-120"], ["#0f0f0f", "#d23a2a", "E-180"], ["#e9e1cf", "#1b1a18", "SP"], ["#8a1c17", "#f3e6c8", "T-160"], ["#2b5aa8", "#f2d24b", "HG"],
    ["#151515", "#e8e0cc", "E-240"], ["#d8cdb5", "#8a1c17", "LP"], ["#23402c", "#e9e1cf", "T-90"], ["#5b1f5f", "#f5b3cd", "EP"], ["#3a3530", "#e4c867", "T-60"],
  ].map(([bg, fg, m]) => ({ blank: true, bg, fg, m }));

  const track = $(".shelf-track"), cap = $(".shelf-caption");
  let items = [], sel = 0;

  const spine = (it, i) => it.blank
    ? `<button class="spine blank" role="option" aria-selected="false" data-i="${i}" style="background:${it.bg};color:${it.fg}" aria-label="Blank tape"><span class="m">${it.m}</span><span class="t">BLANK</span><span class="b">VHS</span></button>`
    : `<button class="spine" role="option" aria-selected="false" data-i="${i}" style="background:${it.spine.bg};color:${it.spine.fg}" aria-label="${esc(it.title)}"><span class="m">${esc(it.spine.mark)}</span><span class="t">${esc(it.title.length > 30 ? it.title.slice(0, 29) + "…" : it.title)}</span><span class="b">${esc(it.year || "")}</span></button>`;

  function cover(it) {
    const front = it.blank
      ? `<button class="front blank" data-open-add><span class="ttl">Blank tape</span><span class="mono" style="margin-top:12px">+ record a paper</span></button>`
      : `<a class="front" href="paper.html?id=${encodeURIComponent(it.id)}" style="background:${it.spine.bg};color:${it.spine.fg}">
           <span class="who">${esc([it.author, it.year].filter(Boolean).join(" · "))}</span>
           <div class="art">${PA.safeSVG(it.chapters[0].svg) || PA.drawing("bubble")}</div>
           <span class="ttl">${esc(it.title)}</span></a>`;
    return `<div class="cover" role="option" aria-selected="true"><div class="layer l2"></div><div class="layer l1"></div>${front}</div>`;
  }

  function caption(it) {
    if (it.blank) return `<h3>Blank tape</h3><div class="red">Room for your next paper</div><div class="yr"><button class="btn-mini" data-open-add>Record a paper →</button></div>`;
    const status = it.kept
      ? `<span class="chip keep-chip">Saved on this device</span> <button class="btn-mini" data-unkeep="${esc(it.id)}">Don’t keep</button>`
      : `<span class="chip keep-chip temp">This session only</span> <button class="btn-mini" data-keep-id="${esc(it.id)}">Keep it</button>`;
    return `<h3>${esc(it.title)}</h3><div class="red">${esc([it.author, it.venue].filter(Boolean).join(" · "))}</div>
      <div class="yr">${esc(it.year || "")}${it.year ? " · " : ""}<a href="paper.html?id=${encodeURIComponent(it.id)}">Open the tape →</a></div>
      <div class="yr status">${status} · <a class="btn-mini" href="paper.html?id=${encodeURIComponent(it.id)}&amp;pdf=1">Download PDF</a> · <button class="btn-mini" data-remove="${esc(it.id)}">Remove</button></div>`;
  }

  function renderShelf() {
    track.innerHTML = items.map((it, i) => (i === sel ? cover(it) : spine(it, i))).join("");
    cap.innerHTML = caption(items[sel]);
    const c = track.querySelector(".cover");
    track.scrollLeft = c.offsetLeft - track.clientWidth / 2 + c.offsetWidth / 2;
  }

  let papers = [];
  async function refresh(selectId) {
    papers = await PA.store.all();
    const blanks = BLANKS.slice(0, Math.max(6, 10 - papers.length));
    const half = Math.ceil(blanks.length / 2);
    items = [...blanks.slice(0, half), ...papers, ...blanks.slice(half)];
    const want = selectId ? items.findIndex((x) => x.id === selectId) : -1;
    sel = want >= 0 ? want : papers.length ? half + papers.length - 1 : half;
    $(".shelf-count").textContent = `${String(papers.length).padStart(2, "0")} paper${papers.length === 1 ? "" : "s"} · ${String(blanks.length).padStart(2, "0")} blank tapes`;
    renderShelf();
    renderData();
  }

  track.addEventListener("click", (e) => {
    const s = e.target.closest(".spine");
    if (s) { sel = +s.dataset.i; renderShelf(); }
  });
  document.querySelectorAll(".shelf-nav button").forEach((b) =>
    b.addEventListener("click", () => { sel = (sel + +b.dataset.dir + items.length) % items.length; renderShelf(); }));
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); sel = (sel + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length; renderShelf(); }
    if (e.key === "Enter") items[sel].blank ? openAdd() : (location.href = `paper.html?id=${encodeURIComponent(items[sel].id)}`);
  });
  addEventListener("resize", () => items.length && renderShelf());

  /* ---------- on this device ---------- */
  function renderData() {
    const list = $(".data-list");
    list.innerHTML = papers.length
      ? papers.map((p) => `<li><a href="paper.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a>
          <span class="chip keep-chip ${p.kept ? "" : "temp"}">${p.kept ? "Saved" : "This session"}</span>
          <button class="btn-mini" data-remove="${esc(p.id)}">Remove</button></li>`).join("")
      : `<li class="muted">No papers yet. Every tape is blank.</li>`;
    $("[data-clear-saved]").hidden = !papers.some((p) => p.kept);
  }

  document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-open-add]")) { e.preventDefault(); openAdd(); return; }
    const rm = t.closest("[data-remove]");
    if (rm) {
      const p = papers.find((x) => x.id === rm.dataset.remove);
      if (p && confirm(`Remove “${p.title}” from this device? This can’t be undone.`)) { await PA.store.remove(p.id); refresh(); }
      return;
    }
    const k = t.closest("[data-keep-id]");
    if (k) {
      const p = papers.find((x) => x.id === k.dataset.keepId);
      try { await PA.store.keep(p); } catch (err) { alert("This browser wouldn’t save it (private browsing can block storage). It’s still here for this session."); }
      refresh(p.id);
      return;
    }
    const u = t.closest("[data-unkeep]");
    if (u) { const p = papers.find((x) => x.id === u.dataset.unkeep); await PA.store.holdForSession(p); refresh(p.id); return; }
    if (t.closest("[data-clear-saved]") && confirm("Delete every saved paper from this device? This can’t be undone.")) { await PA.store.clearSaved(); refresh(); }
  });

  /* ---------- add a paper ---------- */
  const dlg = $(".add-dlg");
  const steps = [...dlg.querySelectorAll(".add-step")];
  const fileInput = $("#pdf"), modelSel = $("#browser-model"), drop = $(".drop"), goBtn = $("[data-go]");
  let file = null, run = null, result = null;

  const show = (name) => steps.forEach((s) => (s.hidden = s.dataset.step !== name));
  const err = (step, msg) => { const el = dlg.querySelector(`[data-step="${step}"] .add-err`); el.textContent = msg || ""; el.hidden = !msg; };

  const engineInputs = [...dlg.querySelectorAll('input[name="engine"]')];
  const chosenEngine = () => (engineInputs.find((i) => i.checked) || {}).value;
  let owner = "the site owner"; // who approves Claude access on a deployed site

  async function loadEngines() {
    const info = await PA.engines();
    engineInputs.forEach((input) => {
      const e = info[input.value];
      input.disabled = !e.available;
      $(`.eng-note[data-for="${input.value}"]`).textContent = e.note;
    });
    owner = info.claude.owner || owner;
    const hint = $(".access-hint");
    hint.hidden = info.claude.access !== "request";
    $("span", hint).textContent = "Want to use Claude?";
    const prev = modelSel.value;
    modelSel.innerHTML = info.browser.models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}${m.cached ? " · downloaded" : ""}</option>`).join("");
    if (prev) modelSel.value = prev;
    if (!chosenEngine() || engineInputs.find((i) => i.checked).disabled) {
      const first = engineInputs.find((i) => !i.disabled);
      engineInputs.forEach((i) => (i.checked = i === first));
    }
    goBtn.disabled = !chosenEngine();
  }
  modelSel.addEventListener("change", () => { const o = engineInputs.find((i) => i.value === "browser"); if (!o.disabled) o.checked = true; });

  function openAdd() {
    if (run) { dlg.showModal(); return; }
    result = null;
    show("form");
    err("form", "");
    dlg.showModal();
    drop.focus();
    loadEngines();
  }

  /* ---------- asking for Claude access (deployed site) ---------- */
  const accessForm = $(".access-form");
  $("[data-request-access]").addEventListener("click", () => {
    $(".access-lede").textContent = `Claude runs on ${owner}’s API credit, so ${owner} approves each person. Leave your details, and once you’re approved you’ll get a personal link that unlocks Claude.`;
    accessForm.hidden = false;
    $(".access-done").hidden = true;
    err("access", "");
    show("access");
    $("#acc-name").focus();
  });
  dlg.querySelectorAll("[data-access-back]").forEach((b) => b.addEventListener("click", () => show("form")));
  accessForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const send = $('button[type="submit"]', accessForm), email = $("#acc-email").value.trim();
    send.disabled = true;
    err("access", "");
    try {
      await PA.requestAccess({ name: $("#acc-name").value, email, note: $("#acc-note").value });
      accessForm.hidden = true;
      accessForm.reset();
      $(".access-done-text").textContent = `${owner} will look at it and send a personal link to ${email}. Opening it unlocks Claude on that device. Until then, the in-browser writer is free to use.`;
      $(".access-done").hidden = false;
    } catch (x) {
      err("access", x.message);
    } finally {
      send.disabled = false;
    }
  });

  function setFile(f) {
    file = f || null;
    $(".drop-main", drop).innerHTML = file ? `<b>${esc(file.name)}</b> · ${(file.size / 1048576).toFixed(1)} MB` : "Drop a PDF here or <u>choose a file</u>";
    drop.classList.toggle("has-file", !!file);
    err("form", "");
  }
  fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

  $("[data-close-dlg]").addEventListener("click", () => closeAdd());
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeAdd(); });
  function closeAdd() {
    if (run && !confirm("Stop writing this explainer? Nothing will be saved.")) return;
    if (run) { run.abort(); run = null; }
    if (result && !confirm("Close without choosing? The explainer will be kept for this session only.")) return;
    if (result) { PA.store.holdForSession(result).then(() => refresh(result.id)); result = null; }
    dlg.close();
  }

  $("[data-go]").addEventListener("click", async () => {
    const engine = chosenEngine();
    if (!file) return err("form", "Choose a PDF first.");
    if (!engine) return err("form", "No writer is available yet. See the notes above.");

    show("work");
    const phase = $(".work-phase"), meta = $(".work-meta");
    const started = Date.now();
    let last = { phase: "starting" };
    const model = engine === "browser" ? PA.browserModel.MODELS.find((m) => m.id === modelSel.value) : null;
    const who = model ? model.name : "Claude";
    const words = {
      starting: "Getting the tape ready…", reading: `${who} is reading the paper…`, thinking: `${who} is thinking it through…`, writing: "Writing the explainer…",
      downloading: `Downloading ${who} (only the first time)…`, loading: `Loading ${who}…`,
    };
    const paint = () => {
      const s = Math.round((Date.now() - started) / 1000);
      phase.textContent = last.phase === "writing" && last.detail ? `Writing: “${last.detail}”`
        : last.phase === "reading" && last.detail ? `${who} is reading ${last.detail}…`
        : (last.phase === "downloading" || last.phase === "loading") && last.detail ? `${words[last.phase].slice(0, -1)}: ${last.detail}` : words[last.phase] || "";
      meta.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} elapsed${last.chars ? ` · ${last.chars.toLocaleString()} characters written` : ""}`;
    };
    const tick = setInterval(paint, 1000);

    run = PA.generate({ engine, model: model ? model.id : "", file, onProgress: (p) => { last = p; paint(); } });
    try {
      result = await run.done;
      run = null;
      const u = result.usage;
      $(".keep-sum").innerHTML = `<b>${esc(result.title)}</b>: ${plural(result.chapters.length, "chapter")}, ${plural(Object.keys(result.glossary).length, "glossary card")}, ${plural(result.quiz.length, "quiz question")}.<br><span class="mono">${u.engine === "claude" ? "Written by Claude on your Claude plan" : u.engine === "claude-api" ? `Written by ${esc(u.model)} · shared by ${esc(owner)}` : `Written in this browser by ${esc(u.model)} · free`} · ${Math.max(1, Math.round((u.seconds || 0) / 60))} min · ${(u.input || 0).toLocaleString()} tokens in, ${(u.output || 0).toLocaleString()} out</span>`;
      err("keep", "");
      show("keep");
    } catch (e) {
      run = null;
      show("form");
      err("form", await PA.explainError(e));
    } finally {
      clearInterval(tick);
    }
  });

  $("[data-cancel]").addEventListener("click", () => {
    if (!run) return;
    run.abort();
    run = null;
  });

  dlg.querySelectorAll("[data-keep]").forEach((b) => b.addEventListener("click", async () => {
    const paper = result;
    if (b.dataset.keep === "yes") {
      try { await PA.store.keep(paper); }
      catch (e) {
        await PA.store.holdForSession(paper);
        alert("This browser wouldn’t save it (private browsing can block storage), so it’s kept for this session only.");
      }
    } else {
      await PA.store.holdForSession(paper);
    }
    result = null;
    dlg.close();
    location.href = `paper.html?id=${encodeURIComponent(paper.id)}`;
  }));

  if (location.hash === "#new") { history.replaceState(null, "", location.pathname); setTimeout(openAdd, 50); }
  refresh();
})();
