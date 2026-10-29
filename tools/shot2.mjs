#!/usr/bin/env node
import fs from "node:fs";
const base = "http://127.0.0.1:9223";
const fileUrl = "file:///Users/liyajun/Documents/deepseek-harness/default-workspace/work/tomb-atlas/index.html";
const width = Number(process.env.W || 1440), height = Number(process.env.H || 900);
const mobile = process.env.MOBILE === "1", out = process.env.OUT || "/tmp/shot.png";
const hash = process.env.HASH || "", waitMs = Number(process.env.WAIT || 2400);
const page = (await (await fetch(base + "/json/list")).json()).find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", ev => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.exceptionThrown") console.log("PAGE_EXCEPTION " + JSON.stringify(msg.params.exceptionDetails));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
await cmd("Page.enable"); await cmd("Runtime.enable"); await cmd("Log.enable");
await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
await cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
const u = new URL(fileUrl); u.searchParams.set("_shot", String(Date.now()));
await cmd("Page.navigate", { url: u.toString() + hash });
await new Promise(r => setTimeout(r, waitMs));
const m = await cmd("Runtime.evaluate", { expression: `JSON.stringify({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,cards:document.querySelectorAll('.card').length,markers:document.querySelectorAll('#markerLayer .marker').length,clusters:document.querySelectorAll('#markerLayer .cluster').length,drawer:document.querySelector('#drawer').classList.contains('open'),nav:(document.querySelector('.detail-nav')||{}).textContent||''})`, returnByValue: true });
console.log("METRICS " + m.result.value);
const shot = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("SHOT " + out + " " + fs.statSync(out).size);
ws.close(); process.exit(0);
