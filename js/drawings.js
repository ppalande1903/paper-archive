/* Hand-drawn doodles: a few built-in ones for the home page, plus a sanitizer for the
   doodles Claude writes for each chapter. The shared #wobble filter gives strokes a hand-inked jitter. */
window.PA = window.PA || {};

(function () {
  const INK = 'class="ink"';
  const hand = (x, y, t, extra = "") => `<text class="hand" x="${x}" y="${y}" ${extra}>${t}</text>`;

  const D = {
    bubble: {
      label: "A speech bubble saying so basically",
      art: () =>
        `<path ${INK} d="M40 50 H280 Q296 50 296 66 V150 Q296 166 280 166 H130 L96 204 L102 166 H40 Q24 166 24 150 V66 Q24 50 40 50 Z" fill="#fbf8f1"/>
         <path ${INK} d="M58 128 H250 M58 146 H200" style="stroke:var(--muted-ink)"/>`,
      text: () => hand(56, 106, "so basically…", 'class="hand big"'),
    },
    bulb: {
      label: "A light bulb with rays and the word aha",
      art: () =>
        `<path ${INK} d="M160 40 C118 40 96 72 100 104 C103 128 122 140 128 162 H192 C198 140 217 128 220 104 C224 72 202 40 160 40 Z" fill="var(--yellow)"/>
         <path ${INK} d="M130 176 H190 M134 190 H186 M144 204 H176"/>
         <path ${INK} d="M146 162 L150 118 L160 132 L170 118 L174 162"/>
         <path ${INK} d="M60 90 H80 M240 90 H260 M88 40 L102 54 M232 40 L218 54 M160 12 V26" style="stroke:var(--red)"/>`,
      text: () => hand(236, 170, "aha!", 'class="hand red big"') + hand(24, 196, "like a…"),
    },
    pencil: {
      label: "A pencil sketching a star and a squiggle",
      art: () =>
        `<path ${INK} d="M70 150 L96 120 L108 146 L140 136 L118 162 L132 190 L100 178 L78 200 L80 168 L50 160 Z" fill="var(--pink)"/>
         <path ${INK} d="M150 190 C170 170 186 206 206 186 S238 170 252 190" style="stroke:var(--blue);stroke-width:4"/>
         <g transform="rotate(38 230 100)"><rect ${INK} x="206" y="30" width="30" height="120" fill="var(--yellow)"/>
         <path ${INK} d="M206 150 L221 184 L236 150 Z" fill="#fbf8f1"/><path d="M216 172 L221 184 L226 172 Z" class="fill-ink"/>
         <rect ${INK} x="206" y="18" width="30" height="16" fill="var(--pink-2)"/></g>`,
      text: () => hand(36, 60, "draw it out", 'class="hand red"'),
    },
    lookup: {
      label: "An index card under a magnifying glass",
      art: () =>
        `<rect ${INK} x="30" y="40" width="210" height="140" fill="#fbf8f1"/>
         <path ${INK} d="M30 70 H240" style="stroke:var(--red)"/>
         <path ${INK} d="M44 96 H220 M44 118 H200 M44 140 H214 M44 162 H160" style="stroke:var(--blue);stroke-width:1.4"/>
         <circle ${INK} cx="210" cy="140" r="44" fill="rgba(255,255,255,.35)" style="stroke-width:4"/>
         <path ${INK} d="M242 172 L290 220" style="stroke-width:9"/>`,
      text: () => hand(42, 62, "jargon (n.)") + hand(176, 146, "aha", 'class="hand red"'),
    },
  };

  PA.drawing = function (name) {
    const d = D[name];
    if (!d) return "";
    return `<svg class="doodle" viewBox="0 0 320 240" role="img" aria-label="${d.label}"><g filter="url(#wobble)">${d.art()}</g>${d.text()}</svg>`;
  };

  /* Claude's doodles come from an uploaded document, so treat them as untrusted: keep only
     simple shapes and text, and drop every attribute that could load or run anything. */
  const TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan"]);
  const ATTRS = new Set(["viewBox", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "dx", "dy", "points", "width", "height",
    "transform", "class", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity",
    "font-size", "font-weight", "text-anchor"]);
  const PAINT = /^(none|currentColor|#[0-9a-f]{3,8}|[a-z]{3,20}|var\(--(ink|pink|pink-2|yellow|blue|orange|red|green|cherry|paper|muted-ink)\))$/i;

  PA.safeSVG = function (src, label) {
    if (!src || typeof src !== "string") return "";
    const parse = (html) => new DOMParser().parseFromString(html, "text/html").querySelector("svg");
    // small models sometimes return the shapes without their <svg> wrapper
    const svg = parse(src) || (/<(g|path|circle|ellipse|rect|line|poly|text)\b/i.test(src) ? parse(`<svg viewBox="0 0 320 240">${src}</svg>`) : null);
    if (!svg) return "";
    const clean = (el) => {
      [...el.children].forEach((c) => (TAGS.has(c.tagName.toLowerCase()) ? clean(c) : c.remove()));
      const style = [];
      [...el.attributes].forEach(({ name, value }) => {
        const paint = name === "fill" || name === "stroke";
        const bad = !ATTRS.has(name) || /url\(|javascript:|[<>]/i.test(value) || (paint && !PAINT.test(value.trim()));
        if (bad) el.removeAttribute(name);
        else if (paint && /^var\(/i.test(value.trim())) style.push(`${name}:${value.trim()}`); // vetted above; style is portable where attributes may not take var()
      });
      if (style.length) el.setAttribute("style", style.join(";"));
    };
    clean(svg);
    if (!svg.children.length) return "";
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", "0 0 320 240");
    svg.setAttribute("class", "doodle");
    svg.setAttribute("role", "img");
    if (label) svg.setAttribute("aria-label", label);
    // wobble the shapes, keep the handwriting crisp
    const g = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("filter", "url(#wobble)");
    [...svg.children].filter((c) => !/^text$/i.test(c.tagName)).forEach((c) => g.appendChild(c));
    svg.insertBefore(g, svg.firstChild);
    return svg.outerHTML;
  };

  PA.wobbleFilter =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="wobble"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter></svg>';

  PA.esc = PA.esc || ((s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
})();
