"use strict";
const $ = (s) => document.querySelector(s);
const cv = $("#cv");
const ctx = cv.getContext("2d");

let W = 0, H = 0;
const cam = { x: -999.5, y: -999.5 };
let cellPx = 28;

const cache = new Map();
let hud = { lives: 3, score: 0, props: {}, over: false };
let vpMines = 0;
let preview = [];
let previewOk = false;
let propSelected = null;
let hover = null;

const KEY = (x, y) => x + "," + y;
const NUM_COLORS = ["", "#2b6cd4", "#2e9440", "#d63031", "#6c3ecf", "#c46a12", "#12a0a8", "#b83a86", "#555"];
const PROP_INFO = {
  shield: ["🛡️", "护盾：踩雷时自动抵消并中和该雷"],
  hammer: ["🔨", "雷锤：左键安全中和一枚雷"],
  magnet: ["🧲", "磁铁：自动标出 3×3 内的雷"],
  bomb: ["💣", "炸弹：左键安全炸开 5×5 区域"],
  heal: ["❤️", "治疗：恢复 1 点生命(上限 5)"],
};

/* ---------------- websocket ---------------- */
let ws, wsReady = false;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { wsReady = true; sendVp(true); };
  ws.onclose = () => { wsReady = false; setTimeout(connect, 800); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}
function send(o) { if (wsReady) ws.send(JSON.stringify(o)); }

function handle(m) {
  switch (m.t) {
    case "reset":
      cache.clear();
      preview = [];
      $("#overlay").classList.add("hidden");
      break;
    case "hud":
      hud = m;
      if (propSelected && !hud.props[propSelected]) propSelected = null;
      renderHud();
      break;
    case "cells":
      for (const [x, y, s, n] of m.d) {
        if (s === 0) cache.delete(KEY(x, y));
        else cache.set(KEY(x, y), { s, n });
      }
      break;
    case "preview":
      previewOk = !!m.ok;
      preview = m.d.map(([x, y]) => ({ x, y, t0: performance.now() }));
      break;
    case "vpcount":
      vpMines = m.n;
      renderStats();
      break;
    case "drop": {
      const [icon] = PROP_INFO[m.prop];
      toast(`🎁 获得道具 ${icon} ${PROP_INFO[m.prop][1].split("：")[0]}`);
      break;
    }
    case "toast":
      toast(m.msg);
      break;
    case "over":
      $("#finalScore").textContent = `本次共翻开 ${hud.score} 格`;
      $("#overlay").classList.remove("hidden");
      break;
  }
}

/* ---------------- viewport ---------------- */
function scheduleVp() {
  if (scheduleVp.pending) return;
  scheduleVp.pending = true;
  setTimeout(() => {
    scheduleVp.pending = false;
    const r = visRect();
    send({ t: "vp", x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
  }, 120);
}
function visRect() {
  return {
    x0: Math.floor(cam.x / cellPx),
    y0: Math.floor(cam.y / cellPx),
    x1: Math.floor((cam.x + W) / cellPx),
    y1: Math.floor((cam.y + H) / cellPx),
  };
}
const cellAt = (mx, my) => [Math.floor((cam.x + mx) / cellPx), Math.floor((cam.y + my) / cellPx)];

/* ---------------- hud ---------------- */
function renderHud() {
  renderStats();
  $("#lives").textContent = "❤️".repeat(Math.max(0, hud.lives)) + "🖤".repeat(Math.max(0, 5 - hud.lives));
  const box = $("#props");
  box.innerHTML = "";
  for (const p in PROP_INFO) {
    const [icon, tip] = PROP_INFO[p];
    const b = document.createElement("button");
    b.className = "prop" + (propSelected === p ? " sel" : "");
    b.title = tip;
    b.innerHTML = `${icon}<span class="cnt">${hud.props[p] || 0}</span>`;
    bindTap(b, () => {
      if ((hud.props[p] || 0) <= 0) return;
      propSelected = propSelected === p ? null : p;
      renderHud();
    });
    box.appendChild(b);
  }
}
let flagCount = 0;
function renderStats() {
  $("#stats").textContent = `💣 视角内雷数: ${vpMines} · 🚩 视角内已标: ${flagCount} · ⛏️ 已翻开: ${hud.score}`;
}
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.classList.add("fade"), 2000);
  setTimeout(() => el.remove(), 2600);
}

/* ---------------- render ---------------- */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.width = W + "px";
  cv.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scheduleVp();
}
window.addEventListener("resize", resize);

function render(now) {
  requestAnimationFrame(render);
  ctx.fillStyle = "#161a23";
  ctx.fillRect(0, 0, W, H);

  const r = visRect();
  let fc = 0;
  const font = Math.floor(cellPx * 0.62);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.floor(cellPx * 0.72)}px system-ui`;

  for (let x = r.x0; x <= r.x1; x++) {
    const px = Math.round(x * cellPx - cam.x);
    for (let y = r.y0; y <= r.y1; y++) {
      const py = Math.round(y * cellPx - cam.y);
      const c = cache.get(KEY(x, y));
      const s = c ? c.s : 0;
      if (s === 0) {
        ctx.fillStyle = (x + y) & 1 ? "#242b3b" : "#222837";
        ctx.fillRect(px, py, cellPx - 1, cellPx - 1);
      } else if (s === 2) {
        ctx.fillStyle = "#2b3346";
        ctx.fillRect(px, py, cellPx - 1, cellPx - 1);
        fc++;
        if (cellPx >= 14) ctx.fillText("🚩", px + cellPx / 2, py + cellPx / 2 + 1, cellPx);
      } else if (s === 1) {
        ctx.fillStyle = "#d9dfec";
        ctx.fillRect(px, py, cellPx - 1, cellPx - 1);
        if (c.n) {
          ctx.fillStyle = NUM_COLORS[c.n] || "#000";
          ctx.font = `bold ${font}px system-ui`;
          ctx.fillText(c.n, px + cellPx / 2, py + cellPx / 2 + 1);
        }
      } else if (s === 3) {
        ctx.fillStyle = "#c9d2c4";
        ctx.fillRect(px, py, cellPx - 1, cellPx - 1);
        ctx.fillStyle = "#7d8a76";
        ctx.font = `bold ${font}px system-ui`;
        ctx.fillText("✕", px + cellPx / 2, py + cellPx / 2 + 1);
      } else if (s === 4) {
        ctx.fillStyle = "#b03030";
        ctx.fillRect(px, py, cellPx - 1, cellPx - 1);
        if (cellPx >= 14) ctx.fillText("💥", px + cellPx / 2, py + cellPx / 2 + 1, cellPx);
      }
    }
  }
  if (fc !== flagCount) { flagCount = fc; renderStats(); }

  for (const p of preview) {
    const a = 1 - (now - p.t0) / 1500;
    if (a <= 0) continue;
    const c = cache.get(KEY(p.x, p.y));
    const px = Math.round(p.x * cellPx - cam.x);
    const py = Math.round(p.y * cellPx - cam.y);
    if (previewOk) {
      ctx.strokeStyle = `rgba(80,220,120,${0.8 * a})`;
      ctx.strokeRect(px + 0.5, py + 0.5, cellPx - 2, cellPx - 2);
    } else if (!c || c.s === 0) {
      ctx.fillStyle = `rgba(255,64,64,${0.45 * a})`;
      ctx.fillRect(px + 1, py + 1, cellPx - 3, cellPx - 3);
    }
  }
  preview = preview.filter((p) => now - p.t0 < 1500);

  if (hover && (!isMobile || touch)) {
    const [hx, hy] = hover;
    const px = Math.round(hx * cellPx - cam.x);
    const py = Math.round(hy * cellPx - cam.y);
    ctx.strokeStyle = propSelected ? "#ffd166" : "rgba(255,255,255,.75)";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, cellPx - 3, cellPx - 3);
    ctx.lineWidth = 1;
    if (propSelected === "bomb") ctx.strokeRect(px - 2 * cellPx, py - 2 * cellPx, cellPx * 5, cellPx * 5);
    if (propSelected === "magnet") ctx.strokeRect(px - cellPx, py - cellPx, cellPx * 3, cellPx * 3);
  }
}

/* ---------------- input ---------------- */
let spaceDown = false;
let drag = null;
let rDown = false, lastFlagKey = null;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    spaceDown = true;
    cv.style.cursor = "grab";
    e.preventDefault();
  } else if (e.code === "Escape") {
    propSelected = null;
    renderHud();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceDown = false;
    cv.style.cursor = propSelected ? "crosshair" : "default";
  }
});

cv.addEventListener("contextmenu", (e) => e.preventDefault());
cv.addEventListener("auxclick", (e) => e.preventDefault());

cv.addEventListener("mousedown", (e) => {
  if (spaceDown) {
    e.preventDefault();
    drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    cv.style.cursor = "grabbing";
    return;
  }
  const [cx, cy] = cellAt(e.offsetX, e.offsetY);
  if (e.button === 1) {
    e.preventDefault();
    send({ t: "preview", x: cx, y: cy });
  } else if (e.button === 2) {
    e.preventDefault();
    rDown = true;
    lastFlagKey = KEY(cx, cy);
    send({ t: "flag", x: cx, y: cy });
  } else if (e.button === 0) {
    if (propSelected) {
      send({ t: "prop", prop: propSelected, x: cx, y: cy });
    } else {
      send({ t: "reveal", x: cx, y: cy });
    }
  }
});

window.addEventListener("mousemove", (e) => {
  if (drag) {
    cam.x = drag.cx - (e.clientX - drag.sx);
    cam.y = drag.cy - (e.clientY - drag.sy);
    scheduleVp();
    return;
  }
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (mx < 0 || my < 0 || mx >= W || my >= H) { hover = null; return; }
  const [cx, cy] = cellAt(mx, my);
  hover = [cx, cy];
  if (rDown) {
    const k = KEY(cx, cy);
    if (k !== lastFlagKey) {
      lastFlagKey = k;
      send({ t: "flag", x: cx, y: cy });
    }
  }
});

window.addEventListener("mouseup", (e) => {
  if (drag) {
    drag = null;
    cv.style.cursor = spaceDown ? "grab" : (propSelected ? "crosshair" : "default");
  }
  if (e.button === 2) rDown = false;
});

cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [wx, wy] = [(cam.x + e.offsetX) / cellPx, (cam.y + e.offsetY) / cellPx];
  cellPx = Math.min(60, Math.max(10, cellPx * Math.exp(-e.deltaY * 0.0015)));
  cam.x = wx * cellPx - e.offsetX;
  cam.y = wy * cellPx - e.offsetY;
  scheduleVp();
}, { passive: false });

/* touchend 直接触发 + click 兜底：规避 iOS Safari 合成 click 丢失/延迟问题 */
const bindTap = (el, fn) => {
  if (!el) return;
  let tt = 0;
  el.addEventListener("touchend", () => { tt = Date.now(); fn(); });
  el.addEventListener("click", () => { if (Date.now() - tt < 700) return; fn(); });
};
const $tap = (sel, fn) => bindTap($(sel), fn);
$tap("#btnReset", () => send({ t: "reset" }));
$tap("#btnNew", () => send({ t: "reset" }));
$tap("#btnNewMap", () => { send({ t: "reset" }); $("#menu").classList.add("hidden"); });
$tap("#btnMenu", () => $("#menu").classList.toggle("hidden"));
$tap("#btnCloseMenu", () => $("#menu").classList.add("hidden"));
$tap("#btnHelp", () => { $("#menu").classList.add("hidden"); $("#touchHelp").classList.remove("hidden"); });
$tap("#btnHelpOk", () => { localStorage.setItem("helpSeen", "1"); $("#touchHelp").classList.add("hidden"); });

/* ---------------- touch (mobile) ---------------- */
const isMobile = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
let touch = null;
let pinch = null;
let lastTap = { t: 0, key: null };
const TAP_MAX = 320, TAP_SLOP = 10, LONG_MS = 500;
const buzz = (ms) => navigator.vibrate && navigator.vibrate(ms);

cv.addEventListener("touchstart", (e) => {
  if (e.touches.length >= 2) {
    if (touch) clearTimeout(touch.timer);
    touch = null;
    hover = null;
    lastTap = { t: 0, key: null };
    const a = e.touches[0], b = e.touches[1];
    pinch = {
      d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
      px0: cellPx,
      wx: (cam.x + (a.clientX + b.clientX) / 2) / cellPx,
      wy: (cam.y + (a.clientY + b.clientY) / 2) / cellPx,
    };
    e.preventDefault();
    return;
  }
  if (e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  const rect = cv.getBoundingClientRect();
  const [cx, cy] = cellAt(t.clientX - rect.left, t.clientY - rect.top);
  hover = [cx, cy];
  touch = { id: t.identifier, sx: t.clientX, sy: t.clientY, camx: cam.x, camy: cam.y, cx, cy, t0: performance.now(), moved: false, fired: false, timer: null };
  touch.timer = setTimeout(() => {
    if (!touch || touch.moved) return;
    touch.fired = true;
    buzz(30);
    const c = cache.get(KEY(touch.cx, touch.cy));
    if (c && c.s === 1) send({ t: "preview", x: touch.cx, y: touch.cy });
    else if (!c || c.s === 0 || c.s === 2) send({ t: "flag", x: touch.cx, y: touch.cy });
  }, LONG_MS);
}, { passive: false });

cv.addEventListener("touchmove", (e) => {
  if (pinch) {
    if (e.touches.length < 2) return;
    e.preventDefault();
    const a = e.touches[0], b = e.touches[1];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
    cellPx = Math.min(60, Math.max(10, pinch.px0 * (d / pinch.d0)));
    cam.x = pinch.wx * cellPx - mx;
    cam.y = pinch.wy * cellPx - my;
    scheduleVp();
    return;
  }
  if (!touch) return;
  e.preventDefault();
  const t = e.touches[0];
  const dx = t.clientX - touch.sx, dy = t.clientY - touch.sy;
  if (!touch.moved && !touch.fired && (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP)) {
    touch.moved = true;
    clearTimeout(touch.timer);
  }
  if (touch.moved) {
    cam.x = touch.camx - dx;
    cam.y = touch.camy - dy;
    scheduleVp();
  }
  const rect = cv.getBoundingClientRect();
  hover = cellAt(t.clientX - rect.left, t.clientY - rect.top);
}, { passive: false });

const endTouch = (e) => {
  if (e && e.touches && e.touches.length < 2) {
    if (pinch) { pinch = null; lastTap = { t: 0, key: null }; return; }
  }
  if (!touch) return;
  clearTimeout(touch.timer);
  const tch = touch;
  touch = null;
  hover = null;
  if (tch.fired || tch.moved) { lastTap = { t: 0, key: null }; return; }
  if (propSelected) {
    send({ t: "prop", prop: propSelected, x: tch.cx, y: tch.cy });
    buzz(15);
    lastTap = { t: 0, key: null };
    return;
  }
  const now = performance.now();
  const key = KEY(tch.cx, tch.cy);
  if (now - lastTap.t < TAP_MAX && lastTap.key === key) {
    send({ t: "reveal", x: tch.cx, y: tch.cy });
    buzz(15);
    lastTap = { t: 0, key: null };
  } else {
    lastTap = { t: now, key };
  }
};
cv.addEventListener("touchend", endTouch);
cv.addEventListener("touchcancel", () => { if (touch) { clearTimeout(touch.timer); touch = null; } pinch = null; hover = null; });

if (isMobile && !localStorage.getItem("helpSeen")) $("#touchHelp").classList.remove("hidden");

connect();
resize();
requestAnimationFrame(render);
