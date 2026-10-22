// Share links are handed out as `/r/<code>`, never `/?ref=<code>`.
//
// Mail bodies are transferred as quoted-printable, where `=` followed by two
// hex digits is decoded away into a single byte. A ref code is eight characters
// of `[a-z0-9]`, so roughly one `/?ref=` link in five would arrive with its code
// mangled and the referral silently unattributed. A path segment has no `=`.
//
// The redirect is server-side so the landing page still sees the attribution in
// the query string it already reads, with no client-side flash and no JS.
//
// While Buddy Invite is off, this is the 8-character redirect and nothing else.
// While it is on, a memorable share code resolves to its owner's ref code.
// The Notion modules load only in that branch.
import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/r/$code")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        // Off: no Notion, same Location rule as before share codes existed.
        if (!referralProgramEnabled(process.env)) {
          const code = sanitizeRef(params.code);
          return redirect(code ? `/?ref=${code}` : "/");
        }
        const { resolveShareLinkLocation } = await import("@/lib/referral/shareLink.server");
        const location = await resolveShareLinkLocation({
          request,
          home: "/",
          raw: params.code,
          enabled: true,
        });
        return redirect(location);
      },
    },
  },
});
