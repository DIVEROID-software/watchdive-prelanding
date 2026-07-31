import { createFileRoute } from "@tanstack/react-router";

import { homePath, localeFromPathSegment } from "@/lib/i18n/locale";

function sanitizeRef(value: string | undefined): string | undefined {
  const code = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return /^[a-z0-9]{8}$/.test(code) ? code : undefined;
}

export const Route = createFileRoute("/$locale/r/$code")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const locale = localeFromPathSegment(params.locale);
        const code = sanitizeRef(params.code);
        const home = locale ? homePath(locale) : "/";
        return new Response(null, {
          status: 302,
          headers: {
            Location: code ? `${home}?ref=${code}` : home,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
