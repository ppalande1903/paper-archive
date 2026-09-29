/* Admin page for a deployed Paper Archive (server.py in hosted mode): approve or deny requests to use Claude,
   send people their access link, revoke access, and see what Claude has cost this month.
   Everything people typed is inserted as text, never as HTML. */
(function () {
  const $ = (s, el = document) => el.querySelector(s);

  async function api(path, body) {
    const r = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Paper-Archive": "1", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { status: r.status });
    return data;
  }

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v);
    }
    n.append(...kids.flat().filter((c) => c != null && c !== false));
    return n;
  }
  const when = (t) => (t ? new Date(t * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
  const money = (c) => "$" + (c || 0).toFixed(2);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  /* ---------- sign in ---------- */
  function showLogin() {
    $(".adm-main").hidden = true;
    $("[data-logout]").hidden = true;
    $(".adm-login").hidden = false;
    $("#pw").focus();
  }
  $(".adm-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $(".adm-login .add-err");
    errEl.hidden = true;
    try {
      await api("/api/admin/login", { password: $("#pw").value });
      $("#pw").value = "";
      load();
    } catch (x) {
      errEl.textContent = x.message;
      errEl.hidden = false;
    }
  });
  $("[data-logout]").addEventListener("click", async () => { await api("/api/admin/logout", {}); showLogin(); });

  /* ---------- actions ---------- */
  async function act(path, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const res = await api(path, {});
      if (res.link) showLink(res.user, res.link);
    } catch (x) {
      alert(x.message);
    }
    load();
  }

  function showLink(user, link) {
    const subject = "Your Paper Archive access link";
    const body = `Hi ${user.name},\n\nHere's your personal link for using Claude on Paper Archive:\n${link}\n\nOpen it on the device you'll use. It keeps working until I turn it off, so please don't share it.\n`;
    const input = el("input", { value: link, readonly: "", "aria-label": "Access link" });
    $(".adm-link").replaceChildren(
      el("p", {}, el("b", {}, `Send this link to ${user.name}`), ` (${user.email}). Whoever opens it can use Claude on your credit, so send it only to them.`),
      el("div", { class: "adm-linkrow" }, input,
        el("button", { class: "box-btn", type: "button", onclick: async (e) => {
          try { await navigator.clipboard.writeText(link); e.target.textContent = "Copied"; } catch (x) { input.select(); }
        } }, "Copy"),
        el("a", { class: "box-btn", href: `mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` }, "Email it"),
        el("button", { class: "box-btn", type: "button", onclick: () => ($(".adm-link").hidden = true) }, "Done")),
    );
    $(".adm-link").hidden = false;
    input.select();
  }

  /* ---------- the dashboard ---------- */
  function fill(name, rows, empty) {
    $(`[data-list="${name}"]`).replaceChildren(...(rows.length ? rows : [el("p", { class: "adm-empty" }, empty)]));
  }

  function showMain(s) {
    $(".adm-login").hidden = true;
    $(".adm-main").hidden = false;
    $("[data-logout]").hidden = false;

    $(".adm-stats").textContent = `This month: ${money(s.month_spend)} of your ${money(s.budget)} budget · ${plural(s.month_papers, "paper")} · ${s.model} · up to ${plural(s.daily_limit, "paper")} per person per day`;
    $(".adm-bar i").style.width = Math.min(100, (s.month_spend / (s.budget || 1)) * 100) + "%";

    fill("requests", s.requests.map((r) => el("div", { class: "adm-row" },
      el("div", { class: "who" }, el("b", {}, r.name), el("span", {}, `${r.email} · asked ${when(r.created)}`),
        r.note && el("p", { class: "adm-note" }, `“${r.note}”`)),
      el("div", { class: "acts" },
        el("button", { class: "big-btn", type: "button", onclick: () => act(`/api/admin/requests/${r.id}/approve`) }, "Approve"),
        el("button", { class: "box-btn", type: "button", onclick: () => act(`/api/admin/requests/${r.id}/deny`, `Deny ${r.name}’s request?`) }, "Deny")),
    )), "No requests right now.");

    fill("users", s.users.map((u) => el("div", { class: "adm-row" + (u.revoked ? " off" : "") },
      el("div", { class: "who" }, el("b", {}, u.name),
        el("span", {}, u.email),
        el("span", {}, u.revoked ? `Access revoked ${when(u.revoked)}`
          : `${plural(u.papers, "paper")} · ${u.today} today · ${money(u.cost)} · last used ${when(u.last_used)}`)),
      el("div", { class: "acts" }, u.revoked
        ? el("button", { class: "box-btn", type: "button", onclick: () => act(`/api/admin/users/${u.id}/link`, `Give ${u.name} access again with a new link?`) }, "Restore with a new link")
        : [el("button", { class: "box-btn", type: "button", onclick: () => act(`/api/admin/users/${u.id}/link`, `Make a new link for ${u.name}? Their current link stops working.`) }, "New link"),
          el("button", { class: "box-btn", type: "button", onclick: () => act(`/api/admin/users/${u.id}/revoke`, `Revoke ${u.name}’s access? Their link stops working right away.`) }, "Revoke")]),
    )), "Nobody yet. Approve a request and they’ll show up here.");

    fill("jobs", s.jobs.map((j) => el("div", { class: "adm-row" },
      el("div", { class: "who" }, el("b", {}, j.file),
        el("span", {}, `${j.name} · ${when(j.started)} · ${j.status}${j.error ? ` (${j.error})` : ""}`)),
      el("small", {}, `${(j.input_tokens + j.output_tokens).toLocaleString()} tokens · ${money(j.cost)}`),
    )), "No papers written with Claude yet.");
  }

  async function load() {
    try {
      showMain(await api("/api/admin/state"));
    } catch (x) {
      if (x.status === 401) showLogin();
      else if (x.status === 404 || x.status === 403) {
        $(".adm").append(el("p", { class: "hint" }, "This page only works on a Paper Archive server running in hosted mode. See “Deploy it” in the README."));
      } else alert(x.message);
    }
  }

  load();
})();
