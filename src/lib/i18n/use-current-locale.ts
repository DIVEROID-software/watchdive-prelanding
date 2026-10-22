import { useRouterState } from "@tanstack/react-router";
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

import type { LocalizedBetaReviewBodies } from "@/data/beta-reviews.loader";
import { conversionCopy } from "@/lib/conversionCopy";
import { phoneOptInCopy } from "@/lib/phoneOptInCopy";
import { EN_FROZEN_LANDING_MESSAGES, type FrozenLandingMessages } from "./frozen-landing-en";
import { localeFromPathname, type Locale } from "./locale";
import {
  applyPriceClaim,
  priceClaimFromLoaderData,
  withClaimTerms,
  type PriceClaim,
} from "./price-claim";

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

/**
 * The switched-on early-bird claim from the nearest route loader that resolved
 * it (the landing and verify routes). Undefined while Buddy Invite is off.
 */
export function useLandingPriceClaim(): PriceClaim | undefined {
  return useRouterState({
    select: (state) => {
      for (let index = state.matches.length - 1; index >= 0; index -= 1) {
        const claim = priceClaimFromLoaderData(state.matches[index]?.loaderData);
        if (claim) return claim;
      }
      return undefined;
    },
  });
}

/** `conversionCopy[locale]`, with the claim's terms line while it is on. */
export function useConversionCopy(locale: Locale) {
  const claim = useLandingPriceClaim();
  const copy = conversionCopy[locale];
  return useMemo(() => withClaimTerms(copy, claim?.conversionTerms), [copy, claim]);
}

/** `phoneOptInCopy[locale]`, with the claim's terms line while it is on. */
export function usePhoneOptInCopy(locale: Locale) {
  const claim = useLandingPriceClaim();
  const copy = phoneOptInCopy[locale];
  return useMemo(() => withClaimTerms(copy, claim?.phoneTerms), [copy, claim]);
}

/**
 * Read localized copy, falling back to the canonical English client catalog.
 * While Buddy Invite is on, the route's price claim is laid over it; while it
 * is off, this returns the catalog object itself.
 */
export function useFrozenLandingMessages() {
  const claim = useLandingPriceClaim();
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
  const messages = providedMessages ?? matchedMessages ?? EN_FROZEN_LANDING_MESSAGES;
  return useMemo(() => applyPriceClaim(messages, claim), [messages, claim]);
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
