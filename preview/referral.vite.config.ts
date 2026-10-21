import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import appConfig from "../vite.config";

// Buddy Invite local visual QA. Serves the REAL application (routes, theme,
// copy, components) and replaces only the side-effect boundaries with fixed
// fixtures, so no Notion, Resend, analytics or OAuth request can leave the
// machine. This config refuses to build.
//
//   WD_PREVIEW_REFERRAL=on  npx vite --config preview/referral.vite.config.ts   (port 5188)
//   WD_PREVIEW_REFERRAL=off npx vite --config preview/referral.vite.config.ts   (port 5189)
//   WD_PREVIEW_PORT=... overrides the port.
//
// Scenarios: see preview/referral-mock-api.ts.
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const SWITCH = process.env.WD_PREVIEW_REFERRAL === "off" ? "off" : "on";
const PORT = Number(process.env.WD_PREVIEW_PORT) || (SWITCH === "on" ? 5188 : 5189);
const mocks: Record<string, string> = {
  "@/lib/api/waitlist.functions": "referral-mock-api.ts",
  "@/lib/api/referral.functions": "referral-mock-api.ts",
  "@/lib/thirdPartyScripts": "no-third-party.ts",
  "@/lib/pageBehavior": "no-third-party.ts",
  "@vercel/analytics/react": "no-third-party.ts",
  "@vercel/analytics": "no-third-party.ts",
};

const NOW = "2026-10-22T09:30:00.000Z";
const BOARDS: Record<string, unknown> = {
  three: {
    asOf: NOW,
    closed: false,
    entries: [
      { rank: 1, nickname: "BlueFin", credited: 14 },
      { rank: 2, nickname: null, credited: 9 },
      { rank: 3, nickname: "산호초다이버", credited: 6 },
    ],
  },
  long: {
    asOf: NOW,
    closed: false,
    entries: [
      { rank: 1, nickname: "WWWWWWWWWWWWWWWW", credited: 1234 },
      { rank: 2, nickname: "가나다라마바사아자차카타파하가나", credited: 88 },
      { rank: 3, nickname: null, credited: 7 },
    ],
  },
  empty: { asOf: NOW, closed: false, entries: [] },
  closed: {
    asOf: NOW,
    closed: true,
    entries: [{ rank: 1, nickname: "BlueFin", credited: 14 }],
  },
};

function previewBoundary(): Plugin {
  return {
    name: "watchdive-referral-local-preview",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
        res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
        if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/_serverFn/")) {
          next();
          return;
        }
        // Server functions are aliased to the mock module, so their RPC path is
        // never needed; any request that still reaches /api or /_serverFn is
        // answered here and no production handler can run.
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (url.pathname === "/api/referral/leaderboard") {
          if (SWITCH === "off") {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "not_found" }));
            return;
          }
          const ref = new URL(req.headers.referer ?? "/", `http://127.0.0.1:${PORT}`).searchParams;
          const board = BOARDS[ref.get("qaBoard") ?? "three"] ?? BOARDS.three;
          const delay = Number(ref.get("qaBoardDelay") ?? "0");
          setTimeout(() => res.end(JSON.stringify(board)), Number.isFinite(delay) ? delay : 0);
          return;
        }
        if (url.pathname === "/api/auth/providers") {
          res.end(JSON.stringify({ google: true, apple: true }));
          return;
        }
        if (url.pathname === "/api/geo") {
          res.setHeader("Set-Cookie", "wd_geo=KR; Path=/; Max-Age=86400; SameSite=Lax");
          res.end(JSON.stringify({ country: "KR" }));
          return;
        }
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "local_preview_only" }));
      });
    },
  };
}

export default defineConfig(async (env) => {
  if (env.command !== "serve") throw new Error("This local preview must never be built or deployed.");
  const config = await appConfig(env);
  const existing = config.resolve?.alias ?? [];
  const aliases = Array.isArray(existing)
    ? existing
    : Object.entries(existing).map(([find, replacement]) => ({ find, replacement }));
  return {
    ...config,
    plugins: [previewBoundary(), ...(config.plugins ?? [])],
    resolve: {
      ...config.resolve,
      alias: [
        ...Object.entries(mocks).map(([find, replacement]) => ({
          find: new RegExp("^" + find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
          replacement: local(replacement),
        })),
        ...aliases,
      ],
    },
    define: {
      ...config.define,
      __WD_PREVIEW_REFERRAL__: JSON.stringify(SWITCH),
      "import.meta.env.VITE_DESIGN_THEME": JSON.stringify("brutal"),
      "import.meta.env.VITE_WATCHDIVE_I18N_REVIEW": JSON.stringify("true"),
      "import.meta.env.VITE_META_TRACKING_ENABLED": JSON.stringify("false"),
      "import.meta.env.VITE_META_PIXEL_ID": JSON.stringify(""),
      "import.meta.env.VITE_GA_MEASUREMENT_ID": JSON.stringify(""),
      "import.meta.env.VITE_GOOGLE_ADS_ID": JSON.stringify(""),
      "import.meta.env.VITE_CLARITY_PROJECT_ID": JSON.stringify(""),
      "import.meta.env.VITE_CONVERSION_EXPERIMENT_ENABLED": JSON.stringify("false"),
    },
    server: { ...config.server, host: "127.0.0.1", port: PORT, strictPort: true },
  };
});
