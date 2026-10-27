import type { Locale } from '@/lib/i18n/locale';
import { subscriptionCopy } from '@/lib/segments/subscription-copy';
import { SUBSCRIPTION_PRICING } from '@/lib/segments/subscription-pricing';

export function SegmentCostComparison({ locale }: { locale: Locale }) {
  const c = subscriptionCopy(locale);
  const pricing = SUBSCRIPTION_PRICING.scubaAnnual;
  const total = (pricing.unitCents * pricing.periods / 100).toFixed(2);

  return <section id="segment-cost-comparison" className="wd-subscription-comparison wd-segment-shell" aria-labelledby="subscription-title">
    <p className="wd-segment-eyebrow">{c.kicker}</p>
    <h2 id="subscription-title">{c.title}</h2>
    <p className="wd-subscription-lead">{c.lead}</p>
    <div id="subscription-panels" className="wd-subscription-panels">
      <span className="wd-subscription-vs" aria-hidden="true">VS</span>
      <article className="wd-subscription-card wd-subscription-watch">
        <h3>WatchDive<span>{c.watchIncludes}</span></h3>
        <p className="wd-subscription-term">{c.oneTimeLabel}</p>
        <p className="wd-subscription-amount"><strong>${SUBSCRIPTION_PRICING.watchDiveCents / 100}</strong><span>USD</span></p>
        <p className="wd-subscription-included">{c.uspShort}</p>
        <p className="wd-subscription-offer">{c.watchOffer}</p>
      </article>
      <article className="wd-subscription-card">
        <h3>Apple Watch Ultra<span>{c.competitorPlan}</span></h3>
        <p className="wd-subscription-term">{c.twoYearLabel}</p>
        <p className="wd-subscription-amount"><strong>${total}</strong><span>USD</span></p>
        <p className="wd-subscription-calculation">{c.calculation}</p>
      </article>
    </div>
    <p className="wd-subscription-caveat">{c.caveat}</p>
    <details className="wd-subscription-basis">
      <summary>{c.basisLabel}<span aria-hidden="true">+</span></summary>
      <p>{c.basis}</p>
      <a href={SUBSCRIPTION_PRICING.sourceUrl} target="_blank" rel="noopener noreferrer">{c.sourceLabel}<span aria-hidden="true"> ↗</span></a>
    </details>
  </section>;
}
