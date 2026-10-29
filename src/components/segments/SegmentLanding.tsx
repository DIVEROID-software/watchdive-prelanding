import { useEffect, useLayoutEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { LanguageSwitcher } from '../language-switcher';
import { CookieSettingsLink } from '../cookie-choice-bar';
import { SocialSignupResultProvider, SocialAuthResult } from '../social-auth-entry';
import { AcquisitionTools, EmailForm, HOLD_EARLY_SUBMIT_JS } from '@/routes/index';
import { useCurrentLocale, useFrozenLandingMessages } from '@/lib/i18n/use-current-locale';
import { localizePath, privacyPath, termsPath } from '@/lib/i18n/locale';
import { getAttribution } from '@/lib/attribution';
import { segmentCopy, type DiveSegment } from '@/lib/segments/copy';
import { legacyHomeAnchor } from '@/lib/segments/canonical-entry';
import { ONSITE_OFFER_COPY } from '../reservation/onsite-copy';
import { SegmentHeroMedia } from './SegmentHeroMedia';
import { SegmentHeroJump, focusMiddleSignup } from './SegmentHeroJump';
import { SegmentHowInsert } from './SegmentHowInsert';
import { SegmentHowCompat } from './SegmentHowCompat';
import { WatchDiveLogo } from './WatchDiveLogo';
import { FreedivingSurfacePhoto } from './FreedivingSurfacePhoto';
import { SegmentCostComparison } from './SegmentCostComparison';
import { subscriptionCopy } from '@/lib/segments/subscription-copy';
import { heroDisclosureCopy } from '@/lib/segments/hero-disclosure-copy';
import sync640 from '@/assets/live/refresh/sync-app-640.webp';
import sync1000 from '@/assets/live/refresh/sync-app-1000.webp';
import cameraPoster from '@/assets/live/connected-app-poster.jpg';
import cameraVideo from '@/assets/live/connected-app.mp4';
import logbook from '@/assets/live/app3/app3-1.jpg';
import freeLogbook720 from '@/assets/live/segment-heroes/freediving-app-logbook-720.webp';
import freeLogbook1448 from '@/assets/live/segment-heroes/freediving-app-logbook-1448.webp';
import './segments.css';

function HowTitle({ template, tone }: { template: string; tone: 'on-dark' | 'on-light' }) {
  const parts = template.split('{logo}');
  if (parts.length < 2) return template;
  // The official logo already ends with a dot. Keep grammatical suffixes,
  // but do not render a second full stop or glue a following word to the logo.
  const after = parts.slice(1).join('{logo}').replace(/^[.。](?=\s|$)/u, '');
  const space = after.indexOf(' ');
  const glued = space >= 0 ? after.slice(0, space) : after;
  const rest = space >= 0 ? after.slice(space) : '';
  return <>{parts[0]}<span className="wd-segment-how-logo-wrap"><WatchDiveLogo tone={tone} />{glued}</span>{rest}</>;
}

/** The same live form/service, presented after the explanation rather than in the hero.
 * Legacy source hero=middle and offer=bottom on this phase, with separate DOM placement.
 */
export function SegmentLanding({ segment }: { segment: DiveSegment }) {
  const router = useRouter();
  const locale = useCurrentLocale();
  const m = useFrozenLandingMessages();
  const c = segmentCopy(locale, segment);
  const subscription = subscriptionCopy(locale);
  const benefits = [{ title: subscription.benefitTitle, body: subscription.benefitBody }, ...c.benefits.slice(0, 2)];
  const [priceNoteBefore, priceNoteAfter] = c.priceNote.split(c.priceNoteHighlight);
  const [sticky, setSticky] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [campaignQuery, setCampaignQuery] = useState('');
  const isFree = segment === 'freediving';
  const alternate: DiveSegment = isFree ? 'scuba' : 'freediving';
  useEffect(() => { getAttribution(); setCampaignQuery(window.location.search); }, []);
  useLayoutEffect(() => {
    if (segment !== 'scuba' || typeof window === 'undefined') return;
    const nextHash = legacyHomeAnchor(window.location.hash);
    if (!nextHash || nextHash === window.location.hash) return;
    const next = `${window.location.pathname}${window.location.search}${nextHash}`;
    window.history.replaceState(window.history.state, '', next);
    const node = document.getElementById(nextHash.slice(1));
    if (node instanceof HTMLDetailsElement) node.open = true;
    node?.scrollIntoView();
  }, [segment]);
  useEffect(() => {
    document.documentElement.dataset.wdSegment = segment;
    const update = () => {
      const hero = document.getElementById('segment-hero');
      const forms = [...document.querySelectorAll<HTMLElement>('[data-segment-signup]')];
      const height = window.visualViewport?.height ?? window.innerHeight;
      const active = document.activeElement;
      const keyboard = active instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
      const visible = forms.some(form => {
        const r = form.getBoundingClientRect();
        return r.top < height - 65 && r.bottom > 60;
      });
      setSticky(Boolean(hero && hero.getBoundingClientRect().bottom < 0 && !visible && !keyboard));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      delete document.documentElement.dataset.wdSegment;
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [segment]);
  const faq = [
    { q: m.faq.q6, a: m.faq.a6 },
    { q: subscription.faqQuestion, a: subscription.faqAnswer },
    { q: m.faq.q2, a: c.depthAnswer },
    { q: isFree ? m.faq.q4 : m.faq.q3, a: isFree ? m.faq.a4 : m.faq.a3 },
    { q: m.faq.q5, a: m.faq.a5 },
    { q: m.faq.q8, a: m.faq.a8 },
  ];

  function jumpToMiddleSignup(event: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number }) {
    void focusMiddleSignup(event, (options) => router.navigate(options));
  }

  function signup(position: 'middle' | 'bottom') {
    return <section id={`signup-${position}`} data-segment-signup="" data-wd-segment={segment} data-wd-placement={position} className={`wd-segment-signup wd-segment-signup-${position}`} aria-labelledby={`signup-title-${position}`}>
      <div className="wd-segment-signup-heading">
        <p className="wd-segment-eyebrow">KICKSTARTER · WATCHDIVE</p>
        <h2 id={`signup-title-${position}`} tabIndex={position === 'middle' ? -1 : undefined}>{position === 'middle' ? c.signupTitle : c.finalTitle}</h2>
        <p>{position === 'middle' ? c.signupBody : c.finalBody}</p>
        <div className="wd-segment-price"><strong>$149</strong><s>$299</s><span className="wd-segment-discount"><b>50%</b>{' '}<span>{c.discountLabel}</span></span></div>
        <p className="wd-segment-price-note">{priceNoteBefore}<strong className="wd-segment-first100">{c.priceNoteHighlight}</strong>{priceNoteAfter}</p>
        <p className="wd-segment-next-price">{ONSITE_OFFER_COPY[locale].nextPrice}</p>
        <p className="wd-segment-subscription-note">{subscription.uspShort}</p>
        <p className="wd-segment-small">{c.includeNote}</p>
      </div>
      <div className="wd-segment-form">
        <SocialAuthResult locale={locale} />
        <EmailForm id={position === 'middle' ? 'hero' : 'offer'} presentation={{ cta: c.signupCta, note: c.signupNote }} />
        <p className="wd-segment-free-note">{c.noPayment}</p>
      </div>
    </section>;
  }

  return <SocialSignupResultProvider key={`${locale}-${segment}`}>
    <div className={`wd-segment-page wd-segment-${segment}`} data-landing-phase="segments-mobile-20261025">
      <script dangerouslySetInnerHTML={{ __html: HOLD_EARLY_SUBMIT_JS }} />
      <header className="wd-segment-header">
        <nav className="wd-segment-modes" aria-label="WatchDive">
          {(['freediving', 'scuba'] as const).map(mode => <a key={mode} href={`${localizePath(`/${mode}`, locale)}${campaignQuery}`} aria-current={segment === mode ? 'page' : undefined}>{c.modes[mode]}</a>)}
        </nav>
        <LanguageSwitcher variant="code" />
      </header>
      <main>
        <section id="segment-hero" className="wd-segment-hero" aria-labelledby="segment-title">
          <div className="wd-segment-hero-copy">
            <h1 id="segment-title">{c.title.split('\n').map((line, i) => <span key={line} className={i ? 'wd-segment-title-accent' : ''}>{line}</span>)}</h1>
            <p className="wd-segment-intro">{c.intro}</p>
            <div className="wd-segment-hero-offer"><strong>$149</strong><span>{c.priceNote}</span></div>
            <a className="wd-segment-hero-jump" href="#signup-middle" onClick={jumpToMiddleSignup}>{c.signupCta}<span aria-hidden="true">↓</span></a>
          </div>
          <div className="wd-segment-hero-visual">
            <SegmentHeroMedia key={segment} segment={segment} caption={c.heroCaption} />
            <p className="wd-segment-hero-usp"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" /></svg><span>{subscription.usp}</span></p>
          </div>
          <div className="wd-segment-hero-compat-slot">
            <SegmentHeroJump appleLine={heroDisclosureCopy(locale).appleLine} compat={m.compat} faqLabel={c.compatibility} />
          </div>
        </section>

        <section id="segment-benefits" className="wd-segment-benefits wd-segment-shell" aria-labelledby="benefits-title">
          <p className="wd-segment-eyebrow">01 / WATCHDIVE</p>
          <h2 id="benefits-title">{c.benefitTitle}</h2>
          <div className="wd-segment-benefit-list">{benefits.map((benefit, i) => <article key={benefit.title}>
            <span className="wd-segment-number" aria-hidden="true">0{i + 1}</span><div><h3>{benefit.title}</h3><p>{benefit.body}</p></div>
          </article>)}</div>
        </section>

        <section id="segment-how" className="wd-segment-how wd-segment-shell" aria-labelledby="how-title">
          <div className="wd-segment-how-image">
            <SegmentHowInsert alt={m.how.step1Alt} />
          </div>
          <div className="wd-segment-how-copy"><p className="wd-segment-eyebrow">02 / {m.how.kicker}</p><h2 id="how-title"><HowTitle template={c.howTitle} tone={isFree ? 'on-light' : 'on-dark'} /></h2><p>{c.howIntro}</p>
            <ol>{[m.how.step1Title, m.how.step2Title, m.how.step3Title].map((title, i) => <li key={title}><span aria-hidden="true">{i + 1}</span>{title}</li>)}</ol>
          </div>
          <SegmentHowCompat locale={locale} label={c.compatibility} />
        </section>

        <SegmentCostComparison locale={locale} />
        <AcquisitionTools compatibility={false} />

        <div className="wd-segment-shell">{signup('middle')}</div>

        <section id="segment-logbook" className="wd-segment-log wd-segment-shell" aria-labelledby="log-title">
          <div className="wd-segment-log-copy"><p className="wd-segment-eyebrow">03 / DIVEROID APP</p><h2 id="log-title">{c.logTitle}</h2><p>{c.logBody}</p></div>
          {isFree ? <figure className="wd-segment-free-logbook">
            <img src={freeLogbook1448} srcSet={`${freeLogbook720} 720w, ${freeLogbook1448} 1448w`} sizes="(min-width:960px) 55vw, 100vw" width="1448" height="965" alt={c.logImageAlt} loading="lazy" decoding="async" />
          </figure> : <div className="wd-segment-log-images"><img className="wd-segment-sync" src={sync1000} srcSet={`${sync640} 640w, ${sync1000} 1000w`} sizes="(min-width:960px) 45vw, 85vw" width="1000" height="667" alt={m.how.step3Alt} loading="lazy" decoding="async" /><img className="wd-segment-app" src={logbook} width="390" height="844" alt={c.logImageAlt} loading="lazy" decoding="async" /></div>}
        </section>

        {isFree && <FreedivingSurfacePhoto locale={locale} />}

        <section id="segment-camera" className="wd-segment-camera wd-segment-shell" aria-labelledby="camera-title">
          <div><p className="wd-segment-eyebrow">04 / {m.cameras.kicker}</p><h2 id="camera-title">{c.cameraTitle}</h2><p>{c.cameraBody}</p></div>
          <div className="wd-segment-video">{videoOpen ? <video controls autoPlay playsInline preload="none" poster={cameraPoster} src={cameraVideo} aria-label={m.cameras.videoAria} /> : <button type="button" onClick={() => setVideoOpen(true)} aria-label={m.media.play}><img src={cameraPoster} alt={m.cameras.videoAria} width="1280" height="720" loading="lazy" decoding="async" /><span>{m.media.play}<span aria-hidden="true"> ↗</span></span></button>}</div>
        </section>

        <section id="segment-faq" className="wd-segment-faq wd-segment-shell" aria-labelledby="faq-title">
          <p className="wd-segment-eyebrow">{m.faq.kicker}</p><h2 id="faq-title">{c.questionTitle}</h2>
          <div>{faq.map((item, i) => <details id={i === 0 ? 'segment-compatibility' : undefined} key={item.q}><summary>{item.q}<span aria-hidden="true">+</span></summary><p>{item.a}</p></details>)}</div>
        </section>

        <div className="wd-segment-shell">{signup('bottom')}</div>
        <p className="wd-segment-switch wd-segment-shell">{c.switchPrompt}<a href={`${localizePath(`/${alternate}`, locale)}${campaignQuery}`}>{c.modes[alternate]} <span aria-hidden="true">→</span></a></p>
      </main>
      <footer className="wd-segment-footer wd-segment-shell">
        <WatchDiveLogo tone={isFree ? 'on-light' : 'on-dark'} /><p>{m.safety.disclaimer}</p>
        <nav><a href={termsPath(locale)}>{m.footer.terms}</a><a href={privacyPath(locale)}>{m.footer.privacy}</a><CookieSettingsLink /></nav>
        <small>{m.footer.legal.replace('{year}', String(new Date().getFullYear()))}</small>
      </footer>
      {sticky && <aside className="wd-segment-sticky"><div><strong>WatchDive</strong><span>$149 · Kickstarter</span></div><a href="#signup-middle" onClick={jumpToMiddleSignup}>{c.signupCta}<span aria-hidden="true">↗</span></a></aside>}
    </div>
  </SocialSignupResultProvider>;
}
