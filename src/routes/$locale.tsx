import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/not-found-page";
import { EN_FROZEN_LANDING_MESSAGES } from "@/lib/i18n/frozen-landing-en";
import { loadFrozenLandingMessages } from "@/lib/i18n/frozen-landing-loader";
import { localeFromPathSegment } from "@/lib/i18n/locale";
import { isI18nReviewEnabled } from "@/lib/i18n/review-gate";
import { FrozenLandingMessagesProvider } from "@/lib/i18n/use-current-locale";

export const Route = createFileRoute("/$locale")({
  beforeLoad: async ({ params }) => {
    if (!isI18nReviewEnabled(import.meta.env.VITE_WATCHDIVE_I18N_REVIEW)) throw notFound();
    const locale = localeFromPathSegment(params.locale);
    if (!locale) throw notFound();
    const messages = await loadFrozenLandingMessages(locale);
    return { locale, messages };
  },
  component: LocaleLayout,
  notFoundComponent: LocaleNotFound,
});

function LocaleLayout() {
  const { messages } = Route.useRouteContext();
  return (
    <FrozenLandingMessagesProvider messages={messages}>
      <Outlet />
    </FrozenLandingMessagesProvider>
  );
}

function LocaleNotFound() {
  const context = Route.useRouteContext();
  const locale = context.locale ?? "en";
  const messages = context.messages ?? EN_FROZEN_LANDING_MESSAGES;
  return (
    <FrozenLandingMessagesProvider messages={messages}>
      <NotFoundPage copy={messages.errors} locale={locale} />
    </FrozenLandingMessagesProvider>
  );
}
