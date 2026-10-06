// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
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

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Build target for hosting. In the Lovable sandbox this is forced back to
  // cloudflare-module; on Vercel's build (non-sandbox) this makes nitro emit
  // the Vercel output structure so SSR + server functions are served correctly.
  nitro: { preset: "vercel" },
  vite: {
    plugins: [verificationEnvPreflight()],
  },
});
