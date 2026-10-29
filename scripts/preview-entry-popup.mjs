// Local review only. Serves the real production build, with all RPC requests
// simulated. No credentials, provider requests, customer rows, or mail sends.
import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".vercel/output");
const functions = path.join(output, "functions/__server.func");
const manifestFile = (await readdir(functions)).find(name => name.startsWith("__23tanstack-start-server-fn-resolver-"));
const manifest = await readFile(path.join(functions, manifestFile), "utf8");
const names = new Map([...manifest.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName: "([^"]+)"/g)].map(m => [m[1], m[2]]));
globalThis.fetch = async () => { throw new Error("External network is disabled in the local entry-popup preview"); };
const app = (await import(path.join(functions, "index.mjs"))).default;
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon" };
const port = Number(process.env.WATCHDIVE_PREVIEW_PORT || 5229);
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Content-Security-Policy", "connect-src 'self'; form-action 'self'");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/review") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await readFile(path.join(root, "scripts/entry-popup-review.html"))); return;
    }
    if (/^\/_server(?:Fn)?\//.test(url.pathname)) {
      req.resume();
      const name = names.get(url.pathname.split("/").pop()) || "";
      let result = {};
      if (name.startsWith("joinWaitlist_")) result = { status: "pending", handle: "qa-entry-preview-handle", message: "Local preview — no email was sent." };
      else if (name.startsWith("pollVerification_")) result = { status: "pending" };
      else if (name.startsWith("getAcquisitionReadiness_")) result = { compatibility: false, push: { enabled: false } };
      else if (name.startsWith("getReferralProgramStateRpc_")) result = { enabled: false };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result, context: {} }));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { req.resume(); res.writeHead(405); res.end(); return; }
    if (url.pathname.startsWith("/api/")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ enabled: false, country: "KR" })); return; }
    const file = path.resolve(output, "static", "." + decodeURIComponent(url.pathname));
    if (file.startsWith(path.join(output, "static") + path.sep)) {
      try {
        if ((await stat(file)).isFile()) {
          res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
          res.end(await readFile(file)); return;
        }
      } catch { /* render the application route */ }
    }
    const response = await app.fetch(new Request(url, { headers: { "x-vercel-ip-country": "KR" } }), { waitUntil() {} });
    res.statusCode = response.status;
    for (const [key, value] of response.headers) if (!['content-length','content-encoding','cache-control'].includes(key)) res.setHeader(key, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.statusCode = 500; res.end("Local preview error"); console.error(error.message); }
}).listen(port, "127.0.0.1", () => console.log(`Local review: http://127.0.0.1:${port}/ko/scuba?qa=true (all submissions simulated)`));
