import { useRouterState } from "@tanstack/react-router";
import { createContext, createElement, useContext, type ReactNode } from "react";

import type { LocalizedBetaReviewBodies } from "@/data/beta-reviews.loader";
import { EN_FROZEN_LANDING_MESSAGES, type FrozenLandingMessages } from "./frozen-landing-en";
import { localeFromPathname, type Locale } from "./locale";

const FrozenLandingMessagesContext = createContext<FrozenLandingMessages | undefined>(undefined);
const LocalizedBetaReviewBodiesContext = createContext<LocalizedBetaReviewBodies | undefined>(
  undefined,
);

/** A data-only boundary: React context emits no element into the page DOM. */
export function FrozenLandingMessagesProvider({
  children,
  messages,
}: {
  children: ReactNode;
  messages: FrozenLandingMessages;
}) {
  return createElement(FrozenLandingMessagesContext.Provider, { value: messages }, children);
}

/** A landing-only data boundary; React context emits no page element. */
export function LocalizedBetaReviewBodiesProvider({
  children,
  reviewBodies,
}: {
  children: ReactNode;
  reviewBodies?: LocalizedBetaReviewBodies;
}) {
  return createElement(
    LocalizedBetaReviewBodiesContext.Provider,
    { value: reviewBodies },
    children,
  );
}

/** Read presentation language from the route without adding a layout wrapper. */
export function useCurrentLocale(): Locale {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return localeFromPathname(pathname);
}

/** Read localized copy, falling back to the canonical English client catalog. */
export function useFrozenLandingMessages() {
  const providedMessages = useContext(FrozenLandingMessagesContext);
  const matchedMessages = useRouterState({
    select: (state) => {
      for (let index = state.matches.length - 1; index >= 0; index -= 1) {
        const context = state.matches[index]?.context as
          { messages?: FrozenLandingMessages } | undefined;
        if (context?.messages) return context.messages;
      }
      return undefined;
    },
  });
  return providedMessages ?? matchedMessages ?? EN_FROZEN_LANDING_MESSAGES;
}

/** The route-local testimonial rendering; `undefined` means canonical English. */
export function useLocalizedBetaReviewBodies() {
  const providedBodies = useContext(LocalizedBetaReviewBodiesContext);
  const matchedBodies = useRouterState({
    select: (state) => {
      for (let index = state.matches.length - 1; index >= 0; index -= 1) {
        const loaderData = state.matches[index]?.loaderData as
          { reviewBodies?: LocalizedBetaReviewBodies } | undefined;
        if (loaderData?.reviewBodies) return loaderData.reviewBodies;
      }
      return undefined;
    },
  });
  return providedBodies ?? matchedBodies;
}
