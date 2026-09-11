"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8420;
const PUB = path.join(__dirname, "public");
const DENSITY = 0.14;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://local").pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocket.Server({ server });

/* ---------------- world state ---------------- */
let seed, cells, lives, score, props, over;

function resetGame() {
  seed = crypto.randomBytes(4).readUInt32BE(0);
  cells = new Map();
  lives = 3;
  score = 0;
  over = false;
  props = { shield: 0, hammer: 0, magnet: 0, bomb: 0, heal: 0 };
  broadcast({ t: "reset" });
  broadcastHud();
}

function hash32(x, y, s) {
  let h = (s ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ x, 0x2545f491) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h ^ y, 0x27d4eb2f) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x9e3779b1) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const KEY = (x, y) => x + "," + y;
const mineRaw = (x, y) => hash32(x, y, seed) / 4294967296 < DENSITY;
function mineOf(x, y) {
  const c = cells.get(KEY(x, y));
  return c ? c.m : mineRaw(x, y);
}
function num(x, y) {
  let n = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      if ((dx || dy) && mineOf(x + dx, y + dy)) n++;
  return n;
}
function get(x, y) {
  const k = KEY(x, y);
  let c = cells.get(k);
  if (!c) {
    c = { m: mineRaw(x, y), s: 0 };
    cells.set(k, c);
  }
  return c;
}

/* s: 0 hidden / 1 revealed / 2 flagged / 3 neutralized / 4 boom */

const deltas = [];
const mark = (x, y) => deltas.push([x, y, cells.get(KEY(x, y)).s, num(x, y)]);
function flush() {
  if (deltas.length) broadcast({ t: "cells", d: deltas.splice(0) });
  broadcastHud();
}

/* ---------------- actions ---------------- */
function boomCell(x, y) {
  const c = get(x, y);
  if (props.shield > 0) {
    props.shield--;
    c.m = false;
    c.s = 3;
    mark(x, y);
    broadcast({ t: "toast", msg: "🛡️ 护盾挡下了一枚雷！" });
  } else {
    c.s = 4;
    mark(x, y);
    lives--;
    broadcast({ t: "toast", msg: "💥 踩雷了！剩余生命: " + lives });
    if (lives <= 0) {
      lives = 0;
      over = true;
      broadcast({ t: "over" });
    }
  }
}

function openCell(x, y) {
  const c = get(x, y);
  if (c.s !== 0) return false;
  if (c.m) {
    boomCell(x, y);
    return false;
  }
  c.s = 1;
  score++;
  mark(x, y);
  return true;
}

function flood(x, y) {
  const start = get(x, y);
  if (start.s !== 0 || start.m) return;
  start.s = 1;
  score++;
  mark(x, y);
  const q = [[x, y]];
  let guard = 0;
  while (q.length && guard++ < 30000) {
    const [cx, cy] = q.pop();
    if (num(cx, cy) !== 0) continue;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        const c = get(nx, ny);
        if (c.s === 0 && !c.m) {
          c.s = 1;
          score++;
          mark(nx, ny);
          q.push([nx, ny]);
        }
      }
  }
}

function openChord(list) {
  let opened = 0;
  for (const [nx, ny] of list) {
    const c = get(nx, ny);
    if (c.s !== 0) continue;
    if (c.m) boomCell(nx, ny);
    else if (num(nx, ny) === 0) { flood(nx, ny); opened++; }
    else if (openCell(nx, ny)) opened++;
  }
  return opened;
}

function onLeft(x, y) {
  if (over) return;
  const c = get(x, y);
  if (c.s === 0) {
    if (c.m) boomCell(x, y);
    else if (num(x, y) === 0) flood(x, y);
    else openCell(x, y);
    maybeDrop();
  } else if (c.s === 1 && num(x, y) > 0) {
    const n = num(x, y);
    let flags = 0;
    const hidden = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        const nc = cells.get(KEY(nx, ny));
        if (nc && nc.s === 2) flags++;
        else if (!nc || nc.s === 0) hidden.push([nx, ny]);
      }
    if (flags === n) {
      if (openChord(hidden)) maybeDrop();
    }
  }
  flush();
}

function onFlag(x, y) {
  if (over) return;
  const c = get(x, y);
  if (c.s === 0) c.s = 2;
  else if (c.s === 2) c.s = 0;
  else return;
  mark(x, y);
  flush();
}

/* ---------------- props ---------------- */
const PROPS = ["shield", "hammer", "magnet", "bomb", "heal"];
const WEIGHTS = { shield: 20, hammer: 25, magnet: 25, bomb: 20, heal: 10 };
const PROP_NAMES = { shield: "护盾", hammer: "雷锤", magnet: "磁铁", bomb: "炸弹", heal: "治疗药水" };

function maybeDrop() {
  if (Math.random() >= 0.02) return;
  const total = PROPS.reduce((a, p) => a + WEIGHTS[p], 0);
  let r = Math.random() * total;
  for (const p of PROPS) {
    r -= WEIGHTS[p];
    if (r <= 0) {
      props[p]++;
      broadcast({ t: "drop", prop: p });
      break;
    }
  }
}

function onProp(p, x, y) {
  if (over || !PROPS.includes(p) || props[p] <= 0) return;
  if (p === "shield") {
    broadcast({ t: "toast", msg: "🛡️ 护盾为被动道具，踩雷时自动触发" });
    return;
  }
  if (p === "heal") {
    props.heal--;
    lives = Math.min(lives + 1, 5);
  } else if (p === "hammer") {
    const c = get(x, y);
    if (c.s === 0) {
      if (c.m) c.m = false;
      c.s = 3;
      props.hammer--;
      mark(x, y);
    }
  } else if (p === "bomb") {
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx, ny = y + dy;
        const c = get(nx, ny);
        if (c.s !== 0) continue;
        if (c.m) c.m = false;
        else score++;
        c.s = c.m ? 3 : 1;
        mark(nx, ny);
      }
    props.bomb--;
  } else if (p === "magnet") {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx, ny = y + dy;
        const c = get(nx, ny);
        if (c.s === 0 && c.m) {
          c.s = 2;
          mark(nx, ny);
        }
      }
    props.magnet--;
  }
  broadcast({ t: "toast", msg: "使用 " + PROP_NAMES[p] });
  flush();
}

/* ---------------- queries ---------------- */
function previewAt(ws, x, y) {
  if (ws.lastPrev && Date.now() - ws.lastPrev < 150) return;
  ws.lastPrev = Date.now();
  const c = cells.get(KEY(x, y));
  if (!c || c.s !== 1) return;
  const d = [];
  const hidden = [];
  let mineInHidden = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const nx = x + dx, ny = y + dy;
      const nc = cells.get(KEY(nx, ny));
      if (!nc || nc.s === 0) {
        hidden.push([nx, ny]);
        if (mineOf(nx, ny)) mineInHidden++;
      }
      d.push([nx, ny]);
    }
  const safe = hidden.length > 0 && mineInHidden === 0;
  if (safe) {
    openChord(hidden);
    maybeDrop();
    flush();
  }
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "preview", d, ok: safe }));
}

function vpCount(m) {
  const x0 = m.x0 | 0, y0 = m.y0 | 0;
  const x1 = Math.min(m.x1 | 0, x0 + 600), y1 = Math.min(m.y1 | 0, y0 + 600);
  let n = 0;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) if (mineOf(x, y)) n++;
  return n;
}

/* ---------------- transport ---------------- */
function broadcast(str) {
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(typeof str === "string" ? str : JSON.stringify(str));
}
function hudMsg() {
  return { t: "hud", lives, score, props, over };
}
function broadcastHud() {
  broadcast(hudMsg());
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ t: "reset" }));
  ws.send(JSON.stringify(hudMsg()));
  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.t) {
      case "vp":
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "vpcount", n: vpCount(m) }));
        break;
      case "reveal":
        onLeft(m.x | 0, m.y | 0);
        break;
      case "flag":
        onFlag(m.x | 0, m.y | 0);
        break;
      case "preview":
        previewAt(ws, m.x | 0, m.y | 0);
        break;
      case "prop":
        onProp(m.prop, m.x | 0, m.y | 0);
        break;
      case "reset":
        resetGame();
        break;
    }
  });
});

resetGame();
if (require.main === module) {
  server.listen(PORT, () => console.log(`无限画布扫雷已启动: http://localhost:${PORT}`));
}

module.exports = { hash32, mineRaw, num, server, wss, resetGame };
