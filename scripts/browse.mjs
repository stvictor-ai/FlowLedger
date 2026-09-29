// Headless Chrome driver for checking pages the way a visitor sees them.
//   node scripts/browse.mjs <url> [--eval file.js] [--shot out.png] [--width 1440]
// --eval runs the file's expression in the page (awaited) and prints the result;
// --shot captures the full page at 2x. No dependencies beyond Node and Chrome.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const url = args[0];
const opt = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : null; };
const evalFile = opt("--eval");
const shotFile = opt("--shot");
const preFile = opt("--pre");
const tab = opt("--tab");
const selector = opt("--selector"); // capture just this element
const width = Number(opt("--width") ?? 1440);
const port = 9400 + Math.floor(Math.random() * 300);

const chrome = spawn(
  process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
   `--remote-debugging-port=${port}`, `--window-size=${width},900`,
   `--user-data-dir=/tmp/browse-${port}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 40 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
  if (!page) await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 2, mobile: width < 700 });
await send("Page.navigate", { url });
await sleep(3500);

if (preFile) {
  if (tab) await send("Runtime.evaluate", { expression: `window.__TAB__=${JSON.stringify(tab)}` });
  await send("Runtime.evaluate", { expression: readFileSync(preFile, "utf8") });
  await sleep(4500); // the seed reloads the page
}

if (evalFile) {
  const r = await send("Runtime.evaluate", { expression: readFileSync(evalFile, "utf8"), awaitPromise: true, returnByValue: true });
  console.log(r.exceptionDetails ? `ERROR ${r.exceptionDetails.exception?.description}` : r.result.value);
}
if (shotFile && selector) {
  const box = (await send("Runtime.evaluate", { expression: `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:0,y:r.top+scrollY,width:innerWidth,height:r.height}})()`, returnByValue: true })).result.value;
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 } });
  writeFileSync(shotFile, Buffer.from(shot.data, "base64"));
  console.log(`${shotFile} ${selector}`);
} else if (shotFile) {
  const h = (await send("Runtime.evaluate", { expression: "document.documentElement.scrollHeight", returnByValue: true })).result.value;
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(h, 6000), scale: 1 } });
  writeFileSync(shotFile, Buffer.from(shot.data, "base64"));
  console.log(`${shotFile} ${width}x${Math.min(h, 6000)}`);
}
ws.close(); chrome.kill(); process.exit(0);
