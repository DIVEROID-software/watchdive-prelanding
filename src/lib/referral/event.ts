// One content model for the site ladder and both email variants. Compact
// conditions preserve the limits from the reviewed tier copy; every amount
// and threshold is resolved here from program.ts through copyValues.
import type { Locale } from "../i18n/locale.ts";
import { fill, referralCopy } from "./copy.ts";
import { REFERRAL_TIERS, nextTier, type ReferralTierId } from "./program.ts";
import { copyValues } from "./values.ts";

export function referralEvent(locale: Locale, credited: number | null = null) {
  const copy = referralCopy(locale);
  const values = { ...copyValues(locale), count: REFERRAL_TIERS[0].minFriends };
  const t = (text: string) => fill(text, values);
  const next = credited === null ? null : nextTier(credited);
  const steps = REFERRAL_TIERS.map((tier) => ({
    id: tier.id as ReferralTierId | "top",
    badge: String(tier.minFriends),
    badgeUnit: copy.event.badges.unit,
    badgeCaption: tier.minFriends === 1 ? copy.event.badges.one : copy.event.badges.other,
    name: copy.tiers[tier.id].name.split(" · ")[0],
    benefit: t(copy.event.benefits[tier.id]),
    qualifier: tier.id === "first" || tier.id === "buddy" ? copy.event.earlyQualifier : null,
    reached: credited !== null && credited >= tier.minFriends,
    next: next?.id === tier.id,
  }));
  steps.push({
    id: "top",
    badge: `TOP ${values.winners}`,
    badgeUnit: "",
    badgeCaption: copy.event.badges.top,
    name: t(copy.top.name),
    benefit: t(copy.event.benefits.top),
    qualifier: null,
    reached: false,
    next: credited !== null && next === null,
  });
  return {
    label: copy.event.label,
    reached: copy.event.reached,
    next: copy.event.next,
    conditionsTitle: copy.event.conditionsTitle,
    headline: t(copy.event.headline),
    subline: t(copy.event.subline),
    steps,
    conditions: [copy.countingNote, ...Object.values(copy.event.conditions).map(t)],
    rulesLabel: copy.card.rulesLink,
    rulesPath: `${locale === "en" ? "" : `/${locale}`}/buddy-rules`,
  };
}
