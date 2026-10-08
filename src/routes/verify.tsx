import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  confirmVerification,
  grantConfirmationMeasurement,
  withdrawConfirmationMeasurement,
} from "@/lib/api/waitlist.functions";
import { MeasurementAsk, measurementAskEligible } from "@/components/measurement-ask";
import { resolveGeoCountry } from "@/lib/consentRegion";
import {
  getMetaCookies,
  getMetaMeasurementConsent,
  initMetaPixel,
  measurementPermitted,
  trackMetaEmailVerified,
  trackMetaLead,
  trackMetaPhoneLead,
} from "@/lib/metaPixel";
import type { BrowserLead } from "@/lib/verification/contracts";
import { isVerificationTokenShape } from "@/lib/verification/tokenShape";
import { EN_FROZEN_LANDING_MESSAGES } from "@/lib/i18n/frozen-landing-en";
import { homePath, privacyPath, referralPath, termsPath } from "@/lib/i18n/locale";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";

// No third-party script starts on load. This route carries the token in its
// fragment, so the root gates every tag off it. The Meta pixel is started here
// only after the fragment is stripped, the confirmation has succeeded, and
// measurement is allowed — this is the one page most people actually see after
// confirming (in their mail app, not the tab that signed up), so without it the
// confirmation reached Meta with no browser context at all.

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { title: EN_FROZEN_LANDING_MESSAGES.verify.metaTitle },
      {
        name: "description",
        content: EN_FROZEN_LANDING_MESSAGES.verify.metaDescription,
      },
      // The token lives in the fragment, which is never sent on a navigation.
      // no-referrer keeps it out of any onward request this page makes too.
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: VerifyPage,
});

type ViewState =
  "reading" | "waiting" | "confirming" | "verified" | "expired" | "invalid" | "error";

/**
 * A page being prerendered or opened in a background tab was not opened by a
 * person. Some mail clients and link scanners fetch and even execute a page to
 * build a preview, and confirming there would consume somebody's link without
 * them ever seeing it. So the confirmation waits for the document to actually
 * be visible; if it never is, the button below is the manual path.
 */
function isUserPresent(): boolean {
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) return false;
  return document.visibilityState === "visible";
}

// The mail puts the bare token in the fragment: a literal `=` is eaten by the
// quoted-printable transfer encoding mail bodies use. The legacy `token=` form
// is still accepted so any link already in an inbox keeps working.
function tokenFromFragment(hash: string): string | undefined {
  const encoded = hash.replace(/^#/, "");
  // A hand-mangled fragment can be invalid percent-encoding, which throws.
  let raw: string;
  try {
    raw = decodeURIComponent(encoded);
  } catch {
    raw = encoded;
  }
  const token = raw.startsWith("token=") ? raw.slice("token=".length) : raw;
  return isVerificationTokenShape(token) ? token : undefined;
}

function Card({
  children,
  role = "status",
}: {
  children: React.ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div
      role={role}
      aria-live="polite"
      className="rounded-3xl border border-white/15 bg-white/10 p-6 text-white shadow-2xl backdrop-blur sm:p-8"
    >
      {children}
    </div>
  );
}

export function VerifyPage() {
  const locale = useCurrentLocale();
  const copy = useFrozenLandingMessages().verify;
  const [state, setState] = useState<ViewState>("reading");
  // The share link is offered here because most people confirm on the phone
  // they signed up on, leaving the polling tab unseen.
  const [refCode, setRefCode] = useState("");
  // Built from the origin actually serving this page, so no external URL is
  // written into a route that must not reference one.
  const shareUrl =
    typeof window !== "undefined" && refCode
      ? `${window.location.origin}${referralPath(locale, refCode)}`
      : "";
  const token = useRef<string | undefined>(undefined);
  const started = useRef(false);
  const [askMeasurement, setAskMeasurement] = useState(false);

  /**
   * The browser halves of whatever the server just sent, under the server's own
   * event ids so each pair dedupes. The pixel starts here and only here — after
   * every request that carries the token has already been made.
   */
  const fireConversions = (sent: {
    browserLead?: BrowserLead;
    submitLead?: { eventId: string; source: string };
  }) => {
    initMetaPixel();
    if (sent.submitLead) trackMetaLead(sent.submitLead.eventId, sent.submitLead.source);
    if (sent.browserLead) {
      trackMetaEmailVerified(sent.browserLead.eventId, sent.browserLead.source);
      if (sent.browserLead.hasPhone) {
        trackMetaPhoneLead(`${sent.browserLead.eventId}:phone`, sent.browserLead.source);
      }
    }
  };

  /** Records the grant server-side; the server sends what was withheld. */
  const grantMeasurement = async () => {
    // Global Privacy Control (or a refusal) wins over a click here.
    if (!token.current || !measurementPermitted()) return;
    const cookies = getMetaCookies();
    const res = await grantConfirmationMeasurement({
      data: {
        token: token.current,
        ...(cookies.fbp ? { fbp: cookies.fbp } : {}),
        ...(cookies.fbc ? { fbc: cookies.fbc } : {}),
      },
    });
    fireConversions(res);
  };

  /** Refused here: recorded on the signup so nothing is sent for it later. */
  const declineMeasurement = async () => {
    if (!token.current) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await withdrawConfirmationMeasurement({ data: { token: token.current } }).catch(
        () => undefined,
      );
      if (res?.recorded) return;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  };

  const confirm = async () => {
    if (!token.current) {
      setState("invalid");
      return;
    }
    setState("confirming");
    try {
      // This browser's Meta cookies, only when it already allows measurement,
      // so the server's confirmation names the click that brought them here.
      await resolveGeoCountry();
      const cookies = measurementPermitted() ? getMetaCookies() : {};
      const result = await confirmVerification({
        data: {
          token: token.current,
          ...(cookies.fbp ? { fbp: cookies.fbp } : {}),
          ...(cookies.fbc ? { fbc: cookies.fbc } : {}),
        },
      });
      if (result.status === "verified" || result.status === "already_verified") {
        setRefCode(result.refCode ?? "");
        setState("verified");
        if (result.browserLead && measurementPermitted()) {
          // Measurement was allowed for this lead and this browser allows it
          // too: the pixel leg, deduplicated against the server leg by id.
          fireConversions({ browserLead: result.browserLead });
        } else if (result.measurementAsk) {
          if (getMetaMeasurementConsent() === "granted") {
            // This browser already said yes (on the page, before or after the
            // submit): no need to ask again, only to record it for this lead.
            void grantMeasurement().catch(() => {});
          } else if (measurementAskEligible()) {
            setAskMeasurement(true);
          }
        }
        return;
      }
      setState(result.status === "expired" ? "expired" : "invalid");
    } catch {
      setState("error");
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragmentToken = tokenFromFragment(window.location.hash);
    // Strip the fragment before anything else. From here the raw token exists
    // only in this component's memory and travels only in the POST below.
    window.history.replaceState(null, "", window.location.pathname);
    if (!fragmentToken) {
      setState("invalid");
      return;
    }
    token.current = fragmentToken;

    // Pressing the button in the email was the deliberate act, so no second
    // click is needed — but only once a person is actually looking at this
    // page. A prerender or a background tab waits instead.
    const confirmWhenPresent = () => {
      if (!isUserPresent()) return;
      document.removeEventListener("visibilitychange", confirmWhenPresent);
      document.removeEventListener("prerenderingchange", confirmWhenPresent);
      void confirm();
    };

    if (isUserPresent()) {
      void confirm();
    } else {
      setState("waiting");
      document.addEventListener("visibilitychange", confirmWhenPresent);
      document.addEventListener("prerenderingchange", confirmWhenPresent);
    }

    return () => {
      document.removeEventListener("visibilitychange", confirmWhenPresent);
      document.removeEventListener("prerenderingchange", confirmWhenPresent);
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--color-deep-2)] px-5 py-14">
      <div className="w-full max-w-xl">
        <Link to={homePath(locale)} className="mb-5 inline-flex min-h-11 items-center text-body text-white/70 underline">
          {copy.back}
        </Link>

        {(state === "reading" || state === "confirming") && (
          <Card>
            <h1 className="text-heading">{copy.confirmingTitle}</h1>
            <p className="mt-3 text-body leading-relaxed text-white/75">{copy.confirmingBody}</p>
          </Card>
        )}

        {state === "waiting" && (
          <Card>
            <h1 className="text-heading">{copy.waitingTitle}</h1>
            <p className="mt-3 text-body leading-relaxed text-white/75">{copy.waitingBody}</p>
            <button
              type="button"
              onClick={confirm}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/30 px-5 py-3 text-body text-white"
            >
              {copy.confirmButton}
            </button>
          </Card>
        )}

        {state === "verified" && (
          <Card>
            <h1 className="text-heading">{copy.verifiedTitle}</h1>
            <p className="mt-3 text-body leading-relaxed text-white/75">{copy.verifiedBody}</p>

            {/* Most people confirm on the phone they signed up on, so the tab
                that was polling is often never seen again. The share link has
                to be offered here or it is effectively never offered. */}
            {refCode && (
              <div className="mt-5 rounded-xl border border-white/15 bg-white/[0.06] p-4">
                <div className="text-lead text-[color:var(--color-cyan-glow)]">
                  {copy.buddyTitle}
                </div>
                <p className="mt-1 text-body leading-relaxed text-white/70">{copy.buddyBody}</p>
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="mt-3 h-11 w-full rounded-lg bg-white/95 px-3 text-body text-[color:var(--color-deep-2)] outline-none"
                />
              </div>
            )}

            {askMeasurement && (
              <MeasurementAsk tone="card" onAllow={grantMeasurement} onDecline={declineMeasurement} />
            )}

            <a
              href={homePath(locale)}
              className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl border border-white/25 px-5 py-3 text-center text-body text-white"
            >
              {copy.backHome}
            </a>
          </Card>
        )}

        {state === "expired" && (
          <Card role="alert">
            <h1 className="text-heading">{copy.expiredTitle}</h1>
            <p className="mt-3 text-body text-white/75">{copy.expiredBody}</p>
          </Card>
        )}

        {state === "invalid" && (
          <Card role="alert">
            <h1 className="text-heading">{copy.invalidTitle}</h1>
            <p className="mt-3 text-body text-white/75">{copy.invalidBody}</p>
          </Card>
        )}

        {state === "error" && (
          <Card role="alert">
            <h1 className="text-heading">{copy.errorTitle}</h1>
            <p className="mt-3 text-body text-white/75">{copy.errorBody}</p>
            <button
              type="button"
              onClick={confirm}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/30 px-5 py-3 text-body text-white"
            >
              {copy.tryAgain}
            </button>
          </Card>
        )}

        <footer className="mt-8 text-center text-caption text-white/55">
          <nav className="flex justify-center gap-4">
            <Link to={privacyPath(locale)} className="underline">
              {copy.footerPrivacy}
            </Link>
            <Link to={termsPath(locale)} className="underline">
              {copy.footerTerms}
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
