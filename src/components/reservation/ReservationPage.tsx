import { useEffect, useId, useRef, useState } from "react";

import { isI18nReviewEnabled } from "@/lib/i18n/review-gate";
import { LOCALE_PREFERENCE_COOKIE } from "@/lib/i18n/auto-locale";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/locale";

import {
  createReservationSubmitLock,
  fetchReservationStatus,
  requestReservationCheckout,
} from "./client";
import { isTerminalReservationStatus, STATUS_RETRY_DELAYS_MS, type ReservationStatus } from "./contract";
import { buildReservationView } from "./model";
import {
  parseReservationQuery,
  rememberReservationEntry,
  writeInvalidInviteFlag,
  writeStoredLang,
  type ReservationLocale,
} from "./query";
import "./reservation.css";

const LOCALIZED_SITE = isI18nReviewEnabled(import.meta.env.VITE_WATCHDIVE_I18N_REVIEW);

function rememberLanguage(locale: ReservationLocale) {
  document.cookie = `${LOCALE_PREFERENCE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`;
}

function follow(event: { preventDefault(): void }, href: string, locale?: ReservationLocale) {
  event.preventDefault();
  if (locale) {
    rememberLanguage(locale);
    writeStoredLang(window.sessionStorage, locale);
  }
  window.location.assign(href);
}

export function ReservationPage({ search }: { search: string }) {
  const query = parseReservationQuery(search);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invalidInvite, setInvalidInvite] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState(false);
  const [checkoutConflict, setCheckoutConflict] = useState(false);
  const [status, setStatus] = useState<ReservationStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const acceptId = useId();
  const hintId = useId();
  const statusId = useId();
  const submitLock = useRef(createReservationSubmitLock());

  useEffect(() => {
    const entry = rememberReservationEntry({
      href: window.location.href,
      storage: window.sessionStorage,
    });
    if (entry.replaceUrl) {
      window.location.replace(entry.replaceUrl);
      return;
    }
    setInviteToken(entry.inviteToken);
    setInvalidInvite(entry.invalidInvite);
  }, [search]);

  useEffect(() => {
    const lookup = { inviteToken, sessionId: query.sessionId };
    if (!lookup.inviteToken) return;
    let cancelled = false;
    let timer = 0;
    let attempt = 0;

    const load = () => {
      setStatusLoading(true);
      void fetchReservationStatus(lookup).then((result) => {
        if (cancelled) return;
        setStatusLoading(false);
        if (!result.ok) {
          setStatus(null);
          if (result.reason === "invalid_invite") {
            setStatusError(false);
            setInvalidInvite(true);
            writeInvalidInviteFlag(window.sessionStorage, true);
            return;
          }
          setStatusError(true);
          return;
        }
        setStatus(result.status);
        setStatusError(false);
        const terminal = isTerminalReservationStatus(result.status);
        if (!lookup.sessionId || terminal || attempt >= STATUS_RETRY_DELAYS_MS.length) return;
        const delay = STATUS_RETRY_DELAYS_MS[attempt];
        attempt += 1;
        timer = window.setTimeout(load, delay);
      });
    };

    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inviteToken, query.sessionId, refreshNonce]);

  const view = buildReservationView({
    search,
    inviteToken,
    invalidInvite,
    termsRead,
    termsAccepted,
    submitting,
    status,
    statusError,
    statusLoading,
    checkoutError,
    checkoutConflict,
    localizedSite: LOCALIZED_SITE,
  });
  const copy = view.copy;

  useEffect(() => {
    document.title = copy.metaTitle;
  }, [copy.metaTitle]);

  async function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!submitLock.current.tryBegin()) return;
    if (!view.checkoutEnabled || !inviteToken) {
      submitLock.current.end();
      return;
    }
    setSubmitting(true);
    setCheckoutError(false);
    setCheckoutConflict(false);
    const result = await requestReservationCheckout(inviteToken);
    if (!result.ok) {
      submitLock.current.end();
      setSubmitting(false);
      if (result.reason === "invalid_invite") {
        setInvalidInvite(true);
        writeInvalidInviteFlag(window.sessionStorage, true);
        return;
      }
      if (result.reason === "conflict") {
        setCheckoutConflict(true);
        setRefreshNonce((value) => value + 1);
        return;
      }
      setCheckoutError(true);
      return;
    }
    window.location.assign(result.url);
  }

  return (
    <main className="wd-rsv" lang={view.locale} data-phase={view.phase}>
      <div className="wd-rsv-inner">
        <header className="wd-rsv-header">
          <a
            className="wd-rsv-home"
            href={view.supportLinks.home}
            onClick={(event) => follow(event, view.supportLinks.home)}
          >
            <img
              className="wd-rsv-wordmark"
              src="/brand/reservation/diveroid-wordmark-color-transparent.png"
              alt={copy.home}
              width={1033}
              height={152}
            />
          </a>
          <nav className="wd-rsv-langs" aria-label={copy.languageLabel}>
            {LANGUAGE_OPTIONS.map((option) => (
              <a
                key={option.locale}
                className="wd-rsv-lang"
                href={view.languageLinks[option.locale]}
                hrefLang={option.locale}
                lang={option.locale}
                aria-current={view.locale === option.locale ? "true" : undefined}
                onClick={(event) => follow(event, view.languageLinks[option.locale], option.locale)}
              >
                {option.label}
              </a>
            ))}
          </nav>
        </header>

        <h1>{copy.title}</h1>
        <p className="wd-rsv-intro">{copy.intro}</p>

        <div
          className="wd-rsv-status"
          id={statusId}
          role="status"
          aria-live="polite"
          aria-busy={statusLoading}
          data-phase={view.phase}
        >
          <p>{statusLoading ? copy.checkingStatus : view.statusText}</p>
          {view.statusDetail ? <p>{view.statusDetail}</p> : null}
        </div>

        {view.checkoutErrorText ? (
          <p className="wd-rsv-error" role="alert">
            {view.checkoutErrorText}
          </p>
        ) : null}

        <section className="wd-rsv-prices" aria-labelledby="reservation-prices">
          <h2 id="reservation-prices">{copy.priceHeading}</h2>
          <dl>
            {copy.priceRows.map((row) => (
              <div
                className={row.id === "total" ? "wd-rsv-price wd-rsv-total" : "wd-rsv-price"}
                key={row.id}
              >
                <dt>{row.label}</dt>
                <dd className="wd-rsv-amount">{row.amount}</dd>
                <dd className="wd-rsv-detail">{row.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="wd-rsv-terms" aria-labelledby="reservation-terms">
          <h2 id="reservation-terms">{copy.termsHeading}</h2>
          <ol>
            {copy.terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ol>
          {view.showCheckoutForm ? (
            <form onSubmit={onSubmit} noValidate>
              <button
                type="button"
                className="wd-rsv-read"
                aria-pressed={termsRead}
                onClick={() => setTermsRead(true)}
              >
                {termsRead ? copy.markReadDone : copy.markRead}
              </button>
              <label className="wd-rsv-accept" htmlFor={acceptId}>
                <input
                  id={acceptId}
                  type="checkbox"
                  checked={termsAccepted}
                  disabled={!termsRead}
                  onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
                />
                <span>{copy.acceptLabel}</span>
              </label>
              {view.checkoutHint ? (
                <p className="wd-rsv-hint" id={hintId}>
                  {view.checkoutHint}
                </p>
              ) : null}
              <button
                type="submit"
                className="wd-rsv-submit"
                disabled={!view.checkoutEnabled}
                aria-describedby={view.checkoutHint ? hintId : statusId}
              >
                {submitting ? copy.checkingOut : copy.checkout}
              </button>
            </form>
          ) : null}
          {view.showCheckAgain ? (
            <button
              type="button"
              className="wd-rsv-check"
              disabled={statusLoading}
              onClick={() => setRefreshNonce((value) => value + 1)}
            >
              {copy.checkAgain}
            </button>
          ) : null}
        </section>

        <nav className="wd-rsv-links" aria-label={copy.siteTerms}>
          <a
            href={view.supportLinks.privacy}
            onClick={(event) => follow(event, view.supportLinks.privacy)}
          >
            {copy.privacy}
          </a>
          <a
            href={view.supportLinks.terms}
            onClick={(event) => follow(event, view.supportLinks.terms)}
          >
            {copy.siteTerms}
          </a>
        </nav>
        <p className="wd-rsv-contact">{copy.contact}</p>
      </div>
    </main>
  );
}
