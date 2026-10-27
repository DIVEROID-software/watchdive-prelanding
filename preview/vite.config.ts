import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import appConfig from "../vite.config";

// Serve the REAL application, including its routes, loaders, theme and assets.
// Only side-effect boundaries are replaced. This config cannot make a build.
const local = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const mocks: Record<string, string> = {
  "@/lib/api/waitlist.functions": "mock-api.ts",
  "@/lib/api/onsiteReservation.functions": "mock-api.ts",
  "@/lib/thirdPartyScripts": "no-third-party.ts",
  "@/lib/api/referral.functions": "referral-mock-api.ts",
  "@/lib/pageBehavior": "no-third-party.ts",
  "@vercel/analytics/react": "no-third-party.ts",
  "@vercel/analytics": "no-third-party.ts",
};

function previewBoundary(): Plugin {
  return {
    name: "watchdive-original-page-local-preview",
    enforce: "pre",
    transform(source, id) {
      const path = id.replace(/\\/g, "/");
      if (path.endsWith("/src/components/reservation/ReservationPage.tsx")) {
        // Local mock only: never leave the machine for Stripe. The contract still validates the mock response.
        return { code: source.replace("window.location.assign(result.url);", 'window.location.assign("/__preview-checkout");'), map: null };
      }
      if (!path.endsWith("/src/routes/__root.tsx")) return;
      return {
        code: `import { LocalPreviewControls } from ${JSON.stringify(local("LocalPreviewControls.tsx"))};\n` + source.replace(
          "<QueryClientProvider client={queryClient}>",
          "<QueryClientProvider client={queryClient}><LocalPreviewControls />",
        ).replace('<html lang={locale}', '<html translate="no" className="notranslate" lang={locale}').replace("<HeadContent />", '<HeadContent /><meta name="google" content="notranslate" />'),
        map: null,
      };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1:5202");
        res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:5202; frame-src 'none'; form-action 'self'; base-uri 'self'");
        if (url.pathname === "/preview/" || url.pathname === "/preview") {
          res.writeHead(302, { location: "/ko/" }); res.end(); return;
        }
        // Page requests only: ?qaGeo=US stands in for Vercel's edge header, so the REAL server entry
        // (src/server.ts) hands the country down as the wd_geo cookie exactly as it does in production.
        if (!url.pathname.startsWith("/api/") && /^[A-Za-z]{2}$/.test(url.searchParams.get("qaGeo") ?? "")) {
          req.headers["x-vercel-ip-country"] = url.searchParams.get("qaGeo")!.toUpperCase();
        }
        if (url.pathname === "/__preview-checkout") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local mock checkout</title>
<body style="font-family:sans-serif;max-width:420px;margin:32px auto;padding:0 16px;color:#201748">
<p style="background:#fff3cd;border:2px solid #201748;padding:10px;font-size:13px"><b>LOCAL MOCK</b> · Stripe is not contacted. No card, no charge, no email.</p>
<h1 style="font-size:22px">WatchDive reservation fee</h1><p style="font-size:34px;margin:8px 0"><b>$3.00</b> USD</p>
<p style="font-size:13px;line-height:1.5">Stands in for the hosted Stripe Checkout page so the return flow can be reviewed.</p>
<a href="/reservation?session_id=cs_test_localpreview" style="display:block;text-align:center;background:#65ceee;border:2px solid #201748;padding:14px;color:#201748;font-weight:700;text-decoration:none;margin-bottom:10px">Simulate successful payment</a>
<a href="/reservation?canceled=1" style="display:block;text-align:center;border:2px solid #201748;padding:12px;color:#201748;text-decoration:none">Cancel and go back</a></body>`);
          return;
        }
        if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/_serverFn/")) { next(); return; }
        // No production API handler can run from this server, even by a direct request.
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (url.pathname === "/api/auth/providers") { res.end(JSON.stringify({google:true, apple:true})); return; }
        if (url.pathname === "/api/auth/continuation" && req.method === "POST") {
          // Explicit local fixture, never a real OAuth cookie or credential.
          const scenario = new URL(req.headers.referer ?? "/", "http://127.0.0.1:5202").searchParams.get("qaSocial");
          res.end(JSON.stringify(scenario === "verified"
            ? { status: "ready", credential: { kind: "confirmation", value: "local-preview-social-confirmation-not-a-real-token" } }
            : { status: "unavailable", reason: scenario === "expired" ? "expired" : "missing" }));
          return;
        }
        // Opt-in UI QA fixture; the real OAuth handler remains unreachable.
        if (url.pathname === "/api/auth/start" && req.method === "POST" &&
            new URL(req.headers.referer ?? "/", "http://127.0.0.1:5202").searchParams.get("qaGoogleBlocked") === "1") {
          let body = "";
          req.on("data", chunk => { if (body.length < 8000) body += chunk; });
          req.on("end", () => {
            let provider: unknown;
            try { provider = JSON.parse(body).provider; } catch { /* reject below */ }
            res.statusCode = provider === "google" ? 409 : 503;
            res.end(JSON.stringify({error: provider === "google" ? "in_app_browser" : "local_preview_only"}));
          });
          return;
        }
        if (url.pathname === "/api/geo") {
          // Same contract as production: JSON body + wd_geo cookie. ?qaGeo=US on the page picks the access country;
          // qaGeoCookie=0 withholds the cookie so the fetch-only fallback path can be exercised.
          const ref = new URL(req.headers.referer ?? "/", "http://127.0.0.1:5202").searchParams;
          const country = (ref.get("qaGeo") ?? "KR").toUpperCase();
          if (ref.get("qaGeoCookie") !== "0") res.setHeader("Set-Cookie", `wd_geo=${country}; Path=/; Max-Age=86400; SameSite=Lax`);
          res.end(JSON.stringify({country: country === "XX" ? null : country})); return;
        }
        if (url.pathname === "/api/reservation/checkout" && req.method === "POST") {
          let body = "";
          req.on("data", chunk => { if (body.length < 8000) body += chunk; });
          req.on("end", () => {
            let parsed: { inviteToken?: unknown; acceptedTerms?: unknown; termsVersion?: unknown } = {};
            try { parsed = JSON.parse(body); } catch { /* rejected below */ }
            const ok = typeof parsed.inviteToken === "string" && /^(?:v1|pv1)\.local_preview_only\./.test(parsed.inviteToken) &&
              parsed.acceptedTerms === true && parsed.termsVersion === "2026-10-18";
            res.statusCode = ok ? 200 : 400;
            res.end(JSON.stringify(ok ? {url:"https://checkout.stripe.com/c/pay/cs_test_localpreview"} : {error:"rejected_terms"}));
          });
          return;
        }
        if (url.pathname === "/api/reservation/status") {
          // Paid only for the mock session the mock checkout page returns with; bare reads stay unpaid.
          const paid = url.searchParams.get("session_id") === "cs_test_localpreview" && /^Bearer (?:v1|pv1)\.local_preview_only\./.test(String(req.headers.authorization ?? ""));
          res.end(JSON.stringify(paid
            ? {status:"paid",paid:true,sessionId:"cs_test_localpreview",amountTotal:300,currency:"usd",amountRefunded:0,amountRefundPending:0,duplicatePaid:false,source:"stripe"}
            : {status:"unpaid",paid:false,source:"stripe",amountTotal:null,currency:null,preview:true})); return;
        }
        res.statusCode = 503;
        res.end(JSON.stringify({error:"local_preview_only",message:"Local preview: no email, customer record, OAuth or payment is created."}));
      });
    },
  };
}

export default defineConfig(async env => {
  if (env.command !== "serve") throw new Error("This local preview must never be built or deployed.");
  const config = await appConfig(env);
  const existing = config.resolve?.alias ?? [];
  const aliases = Array.isArray(existing) ? existing : Object.entries(existing).map(([find,replacement])=>({find,replacement}));
  return {
    ...config,
    plugins: [previewBoundary(), ...(config.plugins ?? [])],
    resolve: {...config.resolve, alias:[...Object.entries(mocks).map(([find,replacement])=>({find:new RegExp("^"+find.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"$"), replacement:local(replacement)})), ...aliases]},
    define: {...config.define,
      "__WD_PREVIEW_REFERRAL__": JSON.stringify("off"),
      "import.meta.env.VITE_DESIGN_THEME": JSON.stringify("brutal"),
      "import.meta.env.VITE_WATCHDIVE_I18N_REVIEW": JSON.stringify("true"),
      "import.meta.env.VITE_META_TRACKING_ENABLED": JSON.stringify("false"),
      "import.meta.env.VITE_META_PIXEL_ID": JSON.stringify(""),
      "import.meta.env.VITE_GA_MEASUREMENT_ID": JSON.stringify(""),
      "import.meta.env.VITE_GOOGLE_ADS_ID": JSON.stringify(""),
      "import.meta.env.VITE_CLARITY_PROJECT_ID": JSON.stringify(""),
      "import.meta.env.VITE_CONVERSION_EXPERIMENT_ENABLED": JSON.stringify("false"),
      "import.meta.env.VITE_RESERVATION_TEST_MODE": JSON.stringify("true"),
    },
    server:{...config.server,host:"127.0.0.1",port:5202,strictPort:true},
  };
});
