import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import {
  getMetaMeasurementConsent,
  initMetaPixel,
  isMetaPixelConfigured,
  setMetaMeasurementConsent,
  type MetaMeasurementConsent,
} from "@/lib/metaPixel";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Watch Dive — The world's most affordable dive computer" },
      {
        name: "description",
        content:
          "Turn the Apple Watch or Galaxy Watch you already own into a 60 m dive computer. $149 early bird — 50% off at Kickstarter launch.",
      },
      { name: "author", content: "Watch Dive" },
      { property: "og:title", content: "Watch Dive — The world's most affordable dive computer" },
      {
        property: "og:description",
        content:
          "Turn the Apple Watch or Galaxy Watch you already own into a 60 m dive computer. $149 early bird — 50% off at Kickstarter launch.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://watchdive.diveroid.com/" },
      { property: "og:image", content: "https://watchdive.diveroid.com/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Watch Dive — The world's most affordable dive computer" },
      {
        name: "twitter:description",
        content:
          "Turn your Apple or Galaxy Watch into a 60 m dive computer. $149 early bird on Kickstarter.",
      },
      { name: "twitter:image", content: "https://watchdive.diveroid.com/og-image.png" },
    ],
    scripts: [
      {
        src: "https://web-production-2bc5f.up.railway.app/widget.js?v=20260712b&pos=left&label=Questions%3F",
        defer: true,
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <MetaMeasurementConsentBanner />
        <Analytics />
        <Scripts />
      </body>
    </html>
  );
}

function MetaMeasurementConsentBanner() {
  const [choice, setChoice] = useState<MetaMeasurementConsent | "unset" | "loading">("loading");

  useEffect(() => {
    if (!isMetaPixelConfigured()) {
      setChoice("denied");
      return;
    }

    const stored = getMetaMeasurementConsent();
    setChoice(stored ?? "unset");
    if (stored === "granted") initMetaPixel();
  }, []);

  if (choice !== "unset") return null;

  const choose = (nextChoice: MetaMeasurementConsent) => {
    setMetaMeasurementConsent(nextChoice);
    setChoice(nextChoice);
    if (nextChoice === "granted") initMetaPixel();
  };

  return (
    <aside
      aria-label="Optional measurement choices"
      className="fixed inset-x-3 bottom-3 z-[80] mx-auto flex max-w-2xl flex-col gap-3 rounded-2xl border border-white/15 bg-[color:var(--color-deep-2)]/95 p-4 text-sm text-white shadow-[0_20px_60px_-24px_oklch(0.08_0.04_270/0.95)] backdrop-blur-xl sm:flex-row sm:items-center"
    >
      <p className="min-w-0 flex-1 leading-relaxed text-white/75">
        Allow optional Meta measurement to help us understand sign-ups and ad performance.{" "}
        <Link className="text-white underline underline-offset-4" to="/privacy">
          Privacy Policy
        </Link>
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => choose("denied")}
          className="rounded-lg border border-white/20 px-3 py-2 font-semibold text-white/85 hover:bg-white/10"
        >
          No thanks
        </button>
        <button
          type="button"
          onClick={() => choose("granted")}
          className="rounded-lg bg-[color:var(--color-cyan-glow)] px-3 py-2 font-semibold text-[color:var(--color-deep-2)] hover:brightness-105"
        >
          Allow
        </button>
      </div>
    </aside>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
