// Offline preview: serves index.html with its CDN scripts swapped for local
// copies, so the app boots without network access and a headless browser can
// be pointed at it.   node scripts/preview.mjs [port]
// Vendored files are cached in .preview/ (gitignored).
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cache = join(root, ".preview");
const port = Number(process.argv[2] ?? 4700);

const VENDOR = {
  "https://unpkg.com/vue@3.5/dist/vue.global.prod.js": "vue.js",
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js": "xlsx.js",
  "https://unpkg.com/dayjs@1.11/dayjs.min.js": "dayjs.js",
  "https://unpkg.com/dayjs@1.11/plugin/isoWeek.js": "isoWeek.js",
  "https://unpkg.com/dayjs@1.11/plugin/weekOfYear.js": "weekOfYear.js",
  "https://unpkg.com/dayjs@1.11/locale/zh-cn.js": "zh-cn.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4/dist/chart.umd.min.js": "chart.js",
};

mkdirSync(cache, { recursive: true });
for (const [url, name] of Object.entries(VENDOR)) {
  const file = join(cache, name);
  if (existsSync(file)) continue;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`vendored ${name}`);
}

const types = { ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".html": "text/html; charset=utf-8" };

createServer((req, res) => {
  try {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/" || path === "/index.html") {
    // Read on every request so edits show up on reload.
    let html = readFileSync(join(root, "index.html"), "utf8");
    for (const [url, name] of Object.entries(VENDOR)) html = html.replaceAll(url, `/__vendor/${name}`);
    res.writeHead(200, { "content-type": types[".html"], "cache-control": "no-store" });
    return res.end(html);
  }
  const vendored = path.startsWith("/__vendor/") ? join(cache, path.slice(10)) : join(root, normalize(path));
  if (!vendored.startsWith(root) || !existsSync(vendored)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(vendored)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(vendored));
  } catch (error) {
    res.writeHead(500); res.end(String(error?.message ?? error));
  }
}).listen(port, "127.0.0.1", () => console.log(`preview on http://127.0.0.1:${port}/`));
