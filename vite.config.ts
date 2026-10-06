// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { readFileSync } from "node:fs";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";

import { assertVerificationEnv } from "./src/lib/verification/envPreflight";

// Fails a Vercel build whose verification environment is incomplete, before the
// deployment exists to take traffic. Off-Vercel builds only warn: a local
// checkout has no business holding the production sending key.
function verificationEnvPreflight() {
  return {
    name: "watchdive-verification-env-preflight",
    apply: "build" as const,
    buildStart() {
      assertVerificationEnv(process.env);
    },
  };
}

// vercel.json is the one place schedules are declared. Nitro emits a prebuilt
// Build Output, whose own config.json is what Vercel registers crons from, so
// the same list is copied in here rather than maintained twice.
function vercelCrons(): { path: string; schedule: string }[] {
  try {
    const parsed = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"));
    return Array.isArray(parsed.crons) ? parsed.crons : [];
  } catch {
    return [];
  }
}

// The wrapper's type only names `preset`; Nitro itself accepts the full Vercel
// preset options, which pass through untouched.
const nitroOptions = { preset: "vercel", vercel: { config: { crons: vercelCrons() } } };

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Build target for hosting. In the Lovable sandbox this is forced back to
  // cloudflare-module; on Vercel's build (non-sandbox) this makes nitro emit
  // the Vercel output structure so SSR + server functions are served correctly.
  nitro: nitroOptions,
  vite: {
    plugins: [verificationEnvPreflight()],
  },
});
