"use strict";
const WebSocket = require("ws");

const ws = new WebSocket(process.env.WS_URL || "ws://localhost:8420");
const got = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.on("message", (raw) => got.push(JSON.parse(raw)));
const last = (t) => got.filter((m) => m.t === t).pop();
const count = (t) => got.filter((m) => m.t === t).length;
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

async function probe(x, y) {
  const n0 = count("vpcount");
  ws.send(JSON.stringify({ t: "vp", x0: x, y0: y, x1: x, y1: y }));
  while (count("vpcount") === n0) await sleep(50);
  return last("vpcount").n;
}

(async () => {
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "reset" }));
  await sleep(250);
  got.length = 0;

  let numCell = null;
  for (let i = 0; i < 20 && !numCell; i++) {
    ws.send(JSON.stringify({ t: "reveal", x: i * 7, y: 0 }));
    await sleep(250);
    if (last("over")) { ws.send(JSON.stringify({ t: "reset" })); await sleep(250); continue; }
    const m = last("cells");
    if (m) numCell = m.d.find((c) => c[2] === 1 && c[3] > 0);
  }
  if (!numCell) fail("no number cell after 20 tries");
  const [nx, ny] = numCell;
  console.log("0. 找到数字格", [nx, ny], "n=" + numCell[3]);

  ws.send(JSON.stringify({ t: "preview", x: nx + 5, y: ny + 5 }));
  await sleep(300);
  if (count("preview") > 0) fail("hidden cell should not preview");
  console.log("1. 未翻开格不响应预览 OK");

  ws.send(JSON.stringify({ t: "preview", x: nx, y: ny }));
  await sleep(300);
  const pv = last("preview");
  if (!pv || pv.d.length !== 9) fail("preview 3x3: " + (pv && pv.d.length));
  if (pv.d.some((c) => c.length > 2)) fail("preview leaked info: " + JSON.stringify(pv.d[0]));
  console.log("2. 数字中键 3x3 预览 OK(负载仅坐标,无雷/数字), 安全=" + pv.ok);

  const states = new Map();
  for (const g of got) if (g.t === "cells") for (const [x, y, s] of g.d) states.set(x + "," + y, s);
  const around = pv.d.filter(([x, y]) => !(x === nx && y === ny));
  const hiddenBefore = around.filter(([x, y]) => (states.get(x + "," + y) ?? 0) === 0);

  if (!pv.ok && hiddenBefore.length === 0) fail("unsafe but nothing hidden?");

  let mines = 0;
  for (const [x, y] of hiddenBefore) {
    if ((await probe(x, y)) === 1) { mines++; ws.send(JSON.stringify({ t: "flag", x, y })); }
  }
  await sleep(350);
  const openable = hiddenBefore.length - mines;

  ws.send(JSON.stringify({ t: "preview", x: nx, y: ny }));
  await sleep(300);
  const pv2 = last("preview");
  if (openable > 0) {
    if (!pv2.ok) fail("chord should be safe after correct flags");
    console.log(`3. 标${mines}旗后自动翻开 ${openable} 格 OK`);
  } else {
    console.log(`3. 周围全是雷(标${mines}旗,无可翻开格) 跳过翻开断言`);
  }

  ws.send(JSON.stringify({ t: "prop", prop: "bomb", x: 30, y: 30 }));
  await sleep(300);
  const hud = last("hud");
  if (!hud) fail("hud");
  console.log("4. 道具接口 OK, hud:", JSON.stringify({ lives: hud.lives, score: hud.score }));

  ws.close();
  console.log("ALL TESTS PASSED");
  process.exit(0);
})().catch(fail);
