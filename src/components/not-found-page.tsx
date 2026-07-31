import { Link } from "@tanstack/react-router";

import type { FrozenLandingMessages } from "@/lib/i18n/frozen-landing-en";
import { homePath, type Locale } from "@/lib/i18n/locale";

export function NotFoundPage({
  copy,
  locale,
}: {
  copy: FrozenLandingMessages["errors"];
  locale: Locale;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{copy.notFoundHeading}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.notFoundBody}</p>
        <div className="mt-6">
          <Link
            to={homePath(locale)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copy.goHome}
          </Link>
        </div>
      </div>
    </div>
  );
}
