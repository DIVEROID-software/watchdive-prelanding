import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { initMetaPixel } from "@/lib/metaPixel";
import { allowsThirdPartyScripts, SUPPORT_WIDGET_SRC } from "@/lib/thirdPartyScripts";

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
      { name: "author", content: "Watch Dive" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        sizes: "any",
        href: "/favicon.svg",
      },
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

/**
 * The Meta pixel bootstrap, inline in the document head.
 *
 * It used to run from a React effect, which meant `PageView` waited on ~154 KB
 * of JavaScript to download, parse and hydrate. Meta only counts a landing page
 * view once that event fires, so on a phone webview a real visitor could arrive,
 * give up and leave without ever being counted — the arrival metric was firing
 * after the bounce it was supposed to measure.
 *
 * Deliberately a copy of the guards in `metaPixel.ts` rather than an import: an
 * import is the bundle this exists to get ahead of. The shared window flags mean
 * `initMetaPixel()` later finds the work already done and does not repeat it.
 */
function metaPixelBootstrap(pixelId: string): string {
  return `(function(){try{
  if(window.__watchDiveMetaPageViewSent)return;
  if(localStorage.getItem("watchdive.measurement-consent.v3")==="denied")return;
  if(navigator.globalPrivacyControl===true)return;
  var f=window.fbq;if(!f){f=window.fbq=function(){f.callMethod?f.callMethod.apply(f,arguments):f.queue.push(arguments)};
  f.queue=[];f.push=f;f.loaded=!0;f.version="2.0";if(!window._fbq)window._fbq=f;}
  if(!document.getElementById("watchdive-meta-pixel")){var s=document.createElement("script");
  s.id="watchdive-meta-pixel";s.async=!0;s.src="https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);}
  f("consent","grant");
  if(window.__watchDiveMetaPixelId!==${JSON.stringify(pixelId)}){f("init",${JSON.stringify(pixelId)});window.__watchDiveMetaPixelId=${JSON.stringify(pixelId)};}
  f("track","PageView");window.__watchDiveMetaPageViewSent=!0;
}catch(e){}})();`;
}

const META_PIXEL_ID = ((import.meta.env.VITE_META_PIXEL_ID as string | undefined) ?? "").trim();
const META_PIXEL_READY =
  String(import.meta.env.VITE_META_TRACKING_ENABLED ?? "").toLowerCase() === "true" &&
  /^\d{10,20}$/.test(META_PIXEL_ID);

function RootShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const thirdParty = allowsThirdPartyScripts(pathname);

  return (
    <html lang="en">
      <head>
        <HeadContent />
        {thirdParty && META_PIXEL_READY && (
          <script dangerouslySetInnerHTML={{ __html: metaPixelBootstrap(META_PIXEL_ID) }} />
        )}
      </head>
      <body>
        {children}
        {thirdParty && <Analytics />}
        {thirdParty && <script src={SUPPORT_WIDGET_SRC} defer />}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!allowsThirdPartyScripts(pathname)) return;
    initMetaPixel();
  }, [pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
