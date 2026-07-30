// Share links are handed out as `/r/<code>`, never `/?ref=<code>`.
//
// Mail bodies are transferred as quoted-printable, where `=` followed by two
// hex digits is decoded away into a single byte. A ref code is eight characters
// of `[a-z0-9]`, so roughly one `/?ref=` link in five would arrive with its code
// mangled and the referral silently unattributed. A path segment has no `=`.
//
// The redirect is server-side so the landing page still sees the attribution in
// the query string it already reads, with no client-side flash and no JS.
import { createFileRoute } from "@tanstack/react-router";

function sanitizeRef(value: string | undefined): string | undefined {
  const code = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return /^[a-z0-9]{8}$/.test(code) ? code : undefined;
}

export const Route = createFileRoute("/r/$code")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const code = sanitizeRef(params.code);
        // An unreadable code still lands the visitor on the page; only the
        // attribution is dropped. `Location` is built from a fixed path and a
        // validated 8-character code, so it can never leave this origin.
        return new Response(null, {
          status: 302,
          headers: {
            Location: code ? `/?ref=${code}` : "/",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
