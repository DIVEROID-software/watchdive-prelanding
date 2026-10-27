import { useEffect, useId, useRef, useState } from "react";

import { isI18nReviewEnabled } from "@/lib/i18n/review-gate";
import { LOCALE_PREFERENCE_COOKIE } from "@/lib/i18n/auto-locale";
import { MEASUREMENT_CHOICE_EVENT } from "@/components/measurement-ask";
import { RESERVATION_PRESENTATION } from "./presentation";
import { recordAuthoritativeReservation } from "./measurement";

import {
  createReservationSubmitLock,
  fetchReservationStatus,
  requestReservationCheckout,
} from "./client";
import {
  isTerminalReservationStatus,
  STATUS_RETRY_DELAYS_MS,
  type ReservationStatus,
} from "./contract";
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
        recordAuthoritativeReservation(result.status);
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

  useEffect(() => {
    const onChoice = () => {
      setStatus((current) => {
        if (current) recordAuthoritativeReservation(current);
        return current;
      });
    };
    window.addEventListener(MEASUREMENT_CHOICE_EVENT, onChoice);
    return () => window.removeEventListener(MEASUREMENT_CHOICE_EVENT, onChoice);
  }, []);

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
  const presentation = RESERVATION_PRESENTATION[view.locale];
  const showStatus = statusLoading || (view.phase !== "offer" && status?.serverStatus !== "open");

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
          {import.meta.env.VITE_RESERVATION_TEST_MODE === "true" ? (
            <span className="wd-rsv-test" role="status">
              {presentation.testMode}
            </span>
          ) : null}
        </header>
        <div className="wd-rsv-layout">
          <section className="wd-rsv-story">
            <p className="wd-rsv-product">WatchDive</p>
            <h1>{presentation.headline}</h1>
            <figure className="wd-rsv-photo">
              <img
                src="/brand/reservation/watchdive-underwater.jpg"
                alt={presentation.imageAlt}
                width="1440"
                height="960"
                fetchPriority="high"
              />
            </figure>
          </section>
          <section className="wd-rsv-card" aria-labelledby="reservation-offer">
            <p className="wd-rsv-eyebrow">{presentation.eyebrow}</p>
            <h2 id="reservation-offer">{presentation.benefit}</h2>
            <div className="wd-rsv-fee">
              <span>$</span>3
            </div>
            <p className="wd-rsv-fee-label">{presentation.feeLabel}</p>
            <p className="wd-rsv-description">{presentation.description}</p>
            {showStatus ? (
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
            ) : (
              <span id={statusId} />
            )}
            {view.checkoutErrorText ? (
              <p className="wd-rsv-error" role="alert">
                {view.checkoutErrorText}
              </p>
            ) : null}
            {view.showCheckoutForm ? (
              <form onSubmit={onSubmit} noValidate>
                <div className="wd-rsv-disclosure">
                  <p>{copy.intro}</p>
                  <p>{copy.terms[copy.terms.length - 1]}</p>
                </div>
                <label className="wd-rsv-accept" htmlFor={acceptId}>
                  <input
                    id={acceptId}
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => {
                      setTermsRead(event.currentTarget.checked);
                      setTermsAccepted(event.currentTarget.checked);
                    }}
                  />
                  <span>{presentation.consent}</span>
                </label>
                <button
                  type="submit"
                  className="wd-rsv-submit"
                  disabled={!view.checkoutEnabled}
                  aria-describedby={
                    view.checkoutHint &&
                    view.checkoutBlock !== "terms_unread" &&
                    view.checkoutBlock !== "terms_unaccepted"
                      ? hintId
                      : statusId
                  }
                >
                  {submitting ? copy.checkingOut : presentation.cta}
                  <span aria-hidden="true"> →</span>
                </button>
                {view.checkoutHint &&
                view.checkoutBlock !== "terms_unread" &&
                view.checkoutBlock !== "terms_unaccepted" ? (
                  <p className="wd-rsv-hint" id={hintId}>
                    {view.checkoutHint}
                  </p>
                ) : null}
                <p className="wd-rsv-reassurance">{presentation.reassurance}</p>
              </form>
            ) : null}
            {view.showCheckAgain && status?.serverStatus !== "open" ? (
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
        </div>
        <footer className="wd-rsv-footer">
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
          <p>{copy.contact}</p>
          <p>DIVEROID LTD · 16343651</p>
        </footer>
      </div>
    </main>
  );
}
