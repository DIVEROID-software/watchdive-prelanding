import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { confirmVerification } from "@/lib/api/waitlist.functions";

// Deliberately no analytics, pixel or widget import. This route carries the
// token in its fragment, and the root gates every third-party script off it —
// an import here would put one back.

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { title: "Confirm your email — Watch Dive" },
      { name: "description", content: "Confirm your Watch Dive waitlist email." },
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

// `<uuid>.<expiry seconds>.<consent bit>.<43-char mac>` — shape only; the
// signature is the server's business.
const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.\d{1,11}\.[01]\.[A-Za-z0-9_-]{43}$/i;

function tokenFromFragment(hash: string): string | undefined {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? "";
  return TOKEN_PATTERN.test(token) ? token : undefined;
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

function VerifyPage() {
  const [state, setState] = useState<ViewState>("reading");
  // Held only so a confirmed state can be told apart from an empty one; this
  // route deliberately makes no referral claim.
  const [, setRefCode] = useState("");
  const token = useRef<string | undefined>(undefined);
  const started = useRef(false);

  const confirm = async () => {
    if (!token.current) {
      setState("invalid");
      return;
    }
    setState("confirming");
    try {
      const result = await confirmVerification({ data: { token: token.current } });
      if (result.status === "verified" || result.status === "already_verified") {
        setRefCode(result.refCode ?? "");
        setState("verified");
        // The pixel leg belongs to the tab that submitted, which polls for this
        // and already has consent context. Nothing third-party runs here.
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
        <Link to="/" className="mb-5 inline-block text-sm text-white/70 underline">
          ← Watch Dive
        </Link>

        {(state === "reading" || state === "confirming") && (
          <Card>
            <h1 className="text-2xl font-bold sm:text-3xl">Confirming your email…</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              One moment while we confirm this address.
            </p>
          </Card>
        )}

        {state === "waiting" && (
          <Card>
            <h1 className="text-2xl font-bold sm:text-3xl">Confirm your email</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Nothing has been confirmed yet. Press the button to finish.
            </p>
            <button
              type="button"
              onClick={confirm}
              className="mt-6 w-full rounded-xl border border-white/30 px-5 py-3 font-semibold text-white"
            >
              Confirm my email
            </button>
          </Card>
        )}

        {state === "verified" && (
          <Card>
            <h1 className="text-2xl font-bold sm:text-3xl">Your waitlist email is confirmed</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Thanks — this address is confirmed for Watch Dive pre-launch updates. You can close
              this tab, or head back to the page you signed up from.
            </p>
            <a
              href="/"
              className="mt-6 block w-full rounded-xl border border-white/25 px-5 py-3 text-center font-semibold text-white"
            >
              Back to Watch Dive
            </a>
          </Card>
        )}

        {state === "expired" && (
          <Card role="alert">
            <h1 className="text-2xl font-bold">This link has expired</h1>
            <p className="mt-3 text-sm text-white/75">
              Confirmation links last 24 hours. Head back to the Watch Dive page and submit the form
              again to get a fresh one.
            </p>
          </Card>
        )}

        {state === "invalid" && (
          <Card role="alert">
            <h1 className="text-2xl font-bold">This link is not valid</h1>
            <p className="mt-3 text-sm text-white/75">
              It may already have been replaced by a newer confirmation email. Head back to the
              Watch Dive page and submit the form again.
            </p>
          </Card>
        )}

        {state === "error" && (
          <Card role="alert">
            <h1 className="text-2xl font-bold">We could not confirm just now</h1>
            <p className="mt-3 text-sm text-white/75">
              Your link has not been used up. Please try again.
            </p>
            <button
              type="button"
              onClick={confirm}
              className="mt-6 w-full rounded-xl border border-white/30 px-5 py-3 font-semibold text-white"
            >
              Try again
            </button>
          </Card>
        )}

        <footer className="mt-8 text-center text-xs text-white/55">
          <nav className="flex justify-center gap-4">
            <Link to="/privacy" className="underline">
              Privacy
            </Link>
            <Link to="/terms" className="underline">
              Terms
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
