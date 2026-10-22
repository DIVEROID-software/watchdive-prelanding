import { createFileRoute } from "@tanstack/react-router";

import { homePath, localeFromPathSegment } from "@/lib/i18n/locale";
import { referralProgramEnabled } from "@/lib/referral/program";

function sanitizeRef(value: string | undefined): string | undefined {
  const code = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return /^[a-z0-9]{8}$/.test(code) ? code : undefined;
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export const Route = createFileRoute("/$locale/r/$code")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const locale = localeFromPathSegment(params.locale);
        const home = locale ? homePath(locale) : "/";
        // Off: no Notion, same Location rule as before share codes existed.
        if (!referralProgramEnabled(process.env)) {
          const code = sanitizeRef(params.code);
          return redirect(code ? `${home}?ref=${code}` : home);
        }
        const { resolveShareLinkLocation } = await import("@/lib/referral/shareLink.server");
        const location = await resolveShareLinkLocation({
          request,
          home,
          raw: params.code,
          enabled: true,
        });
        return redirect(location);
      },
    },
  },
});
