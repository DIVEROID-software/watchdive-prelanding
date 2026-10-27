/** USD list prices checked against the US App Store on 2026-10-25.
 * Totals model continuous access for two years at unchanged prices.
 * WatchDive is the first-100 Kickstarter offer, excluding the smartwatch.
 */
export const SUBSCRIPTION_PRICING = {
  currency: 'USD',
  checkedAt: '2026-10-25',
  sourceUrl: 'https://apps.apple.com/us/app/scuba-diving-computer-oceanic/id1610517133?platform=watch',
  plansUrl: 'https://www.oceanicworldwide.com/oceanicplus-subscription/',
  scubaAnnual: { unitCents: 7999, periods: 2, period: 'year' },
  watchDiveCents: 14900,
} as const;
