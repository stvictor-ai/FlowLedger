// Local preview: a plain static server for the app, so a headless browser can
// be pointed at it. Libraries live in vendor/, so it needs no network access.
//   node scripts/preview.mjs [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.argv[2] ?? 4700);

const types = { ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".html": "text/html; charset=utf-8" };

createServer((req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    // Read on every request so edits show up on reload.
    const file = join(root, normalize(path));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  } catch (error) {
    res.writeHead(500); res.end(String(error?.message ?? error));
  }
}).listen(port, "127.0.0.1", () => console.log(`preview on http://127.0.0.1:${port}/`));
