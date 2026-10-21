// Server-render the privacy page outside the router, for tests.
//
// src/routes/privacy.tsx is TSX with "@/" imports and router hooks, which node
// cannot run directly. It is bundled with esbuild (react stays external) and
// two modules are swapped for small stand-ins:
//   - @tanstack/react-router: `useRouterState` reads a fake router state that
//     holds the page path, the locale's frozen messages (as the $locale route
//     context does) and the route loader data; `Link` renders a plain <a>.
//   - @/lib/api/referral.functions: `getReferralProgramState` answers from a
//     test-controlled flag instead of the server.
// Everything else (copy catalogs, referral copy, program.ts) is the real code.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { localizePath, type Locale } from "../../src/lib/i18n/locale.ts";
import { FROZEN_LANDING_MESSAGES } from "../../src/lib/i18n/frozen-landing-messages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

const ROUTER_STUB = `
import { createElement } from "react";
export const createFileRoute = () => (options) => ({ options });
export const notFound = () => Object.assign(new Error("not found"), { isNotFound: true });
export const redirect = (options) => Object.assign(new Error("redirect"), { options });
export function useRouterState({ select }) { return select(globalThis.__privacyTestRouterState); }
export function Link({ to, children, ...rest }) { return createElement("a", { href: to, ...rest }, children); }
`;

const REFERRAL_FUNCTIONS_STUB = `
export async function getReferralProgramState() {
  const state = globalThis.__privacyTestProgram;
  if (state === "throw") throw new Error("server function unavailable");
  return { enabled: state === true };
}
`;

export type PrivacyModule = {
  PrivacyPage: () => ReactElement;
  loadPrivacyPageData?: () => Promise<unknown>;
};

export type PrivacyHarness = {
  module: PrivacyModule;
  render(locale: Locale, loaderData: unknown): string;
  setProgram(state: boolean | "throw"): void;
  dispose(): void;
};

/** Bundle `entry` (default: the privacy route) and return a renderer for it. */
export async function loadPrivacyHarness(
  entry = join(root, "src/routes/privacy.tsx"),
): Promise<PrivacyHarness> {
  const cacheDir = join(root, "node_modules/.cache");
  mkdirSync(cacheDir, { recursive: true });
  const outDir = mkdtempSync(join(cacheDir, "privacy-render-"));
  const outfile = join(outDir, "privacy.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom"],
    alias: { "@": join(root, "src") },
    // The head helpers import images; the rendered page never uses their URLs.
    loader: {
      ".webp": "empty",
      ".png": "empty",
      ".jpg": "empty",
      ".svg": "empty",
      ".mp4": "empty",
    },
    plugins: [
      {
        name: "privacy-test-stubs",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^@tanstack\/react-router$/ }, () => ({
            path: "router",
            namespace: "privacy-stub",
          }));
          pluginBuild.onResolve({ filter: /^@\/lib\/api\/referral\.functions$/ }, () => ({
            path: "referral-functions",
            namespace: "privacy-stub",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "privacy-stub" }, (args) => ({
            contents: args.path === "router" ? ROUTER_STUB : REFERRAL_FUNCTIONS_STUB,
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  const module = (await import(pathToFileURL(outfile).href)) as PrivacyModule;
  const globals = globalThis as Record<string, unknown>;
  return {
    module,
    render(locale, loaderData) {
      globals.__privacyTestRouterState = {
        location: { pathname: localizePath("/privacy", locale) },
        matches: [
          { routeId: "__root__", context: {} },
          {
            routeId: locale === "en" ? "/privacy" : "/$locale/privacy",
            context: { messages: FROZEN_LANDING_MESSAGES[locale] },
            loaderData,
          },
        ],
      };
      return renderToStaticMarkup(createElement(module.PrivacyPage));
    },
    setProgram(state) {
      globals.__privacyTestProgram = state;
    },
    dispose() {
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}
