// Build-time validation of everything the verification flow needs at runtime.
//
// A missing signing secret, a Host-shaped origin, an unset Resend key: each one
// turns the Claim form into a 500 for real traffic, and each one is invisible
// until somebody submits. Checking at build time moves that discovery before
// the deployment exists rather than after it is serving.
//
// The From mailbox is help@diveroid.com inside resend.ts. This check does not
// select a sender from WATCHDIVE_EMAIL_FROM. A value that names another
// mailbox fails the build so the variable cannot look valid.
//
// Deliberately dependency-free. This module is loaded by the Vite config, so it
// must not drag the app's module graph — or a secret — into the build tooling.
//
// Kept free of path-alias imports so `npm test` can load it directly.

export type VerificationEnv = Record<string, string | undefined>;

export type EnvProblem = { name: string; problem: string };

const MIN_SECRET_BYTES = 32;

/**
 * Same mailbox as `FIXED_SENDER_MAILBOX` in resend.ts. This module stays
 * dependency-free, so the equality is locked by a test rather than an import.
 */
export const FIXED_SENDER_MAILBOX = "help@diveroid.com";

/** A set From env may only repeat the fixed mailbox. Blank is ready. */
function fixedFromEnv(value: string): boolean {
  if (value === FIXED_SENDER_MAILBOX) return true;
  const match = /^([^<>]*)<\s*([^<>\s]+)\s*>$/.exec(value);
  if (!match) return false;
  const name = match[1].trim();
  if (match[2] !== FIXED_SENDER_MAILBOX) return false;
  return name.length === 0 || !/["\r\n@,;\\]/.test(name);
}

function present(env: VerificationEnv, name: string): string {
  return (env[name] ?? "").trim();
}

/**
 * Returns every problem rather than the first, so one build surfaces the whole
 * list instead of one round trip per missing value.
 */
export function checkVerificationEnv(env: VerificationEnv): EnvProblem[] {
  const problems: EnvProblem[] = [];

  for (const name of ["NOTION_API_KEY", "NOTION_WAITLIST_DB_ID", "RESEND_API_KEY"]) {
    if (!present(env, name)) problems.push({ name, problem: "is not set" });
  }

  // The send path ignores this variable. A contradictory value still fails the
  // build so an old mailbox cannot be mistaken for the From address.
  const from = present(env, "WATCHDIVE_EMAIL_FROM");
  if (from && !fixedFromEnv(from)) {
    problems.push({
      name: "WATCHDIVE_EMAIL_FROM",
      problem: `must be unset or ${FIXED_SENDER_MAILBOX}; the mailbox is fixed in code`,
    });
  }

  const fromName = present(env, "WATCHDIVE_EMAIL_FROM_NAME");
  if (fromName && /["<>\r\n@,;\\\u0000-\u001f\u007f\uFF20\uFE6B]/.test(fromName)) {
    problems.push({
      name: "WATCHDIVE_EMAIL_FROM_NAME",
      problem: "cannot contain another address; blank means WatchDive",
    });
  }

  const replyTo = present(env, "WATCHDIVE_EMAIL_REPLY_TO");
  if (replyTo && !/^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(replyTo)) {
    problems.push({ name: "WATCHDIVE_EMAIL_REPLY_TO", problem: "is not an email address" });
  }

  const secret = present(env, "WATCHDIVE_VERIFICATION_SECRET");
  if (!secret) {
    problems.push({ name: "WATCHDIVE_VERIFICATION_SECRET", problem: "is not set" });
  } else if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    problems.push({
      name: "WATCHDIVE_VERIFICATION_SECRET",
      problem: `must be at least ${MIN_SECRET_BYTES} bytes`,
    });
  }

  problems.push(...checkPublicOrigin(present(env, "WATCHDIVE_PUBLIC_ORIGIN")));
  return problems;
}

/** Same rules the request path enforces, so a build cannot pass what runtime rejects. */
function checkPublicOrigin(raw: string): EnvProblem[] {
  const name = "WATCHDIVE_PUBLIC_ORIGIN";
  if (!raw) return [{ name, problem: "is not set" }];

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return [{ name, problem: "is not an absolute URL" }];
  }
  if (parsed.protocol !== "https:") return [{ name, problem: "must use https" }];
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    return [{ name, problem: "must be a bare origin with no credentials, path or query" }];
  }
  return [];
}

export function formatEnvProblems(problems: EnvProblem[]): string {
  return [
    "Verification environment is incomplete, so this deployment would fail on the first signup:",
    ...problems.map((p) => `  - ${p.name} ${p.problem}`),
    "Set these in the Vercel project settings for this environment and redeploy.",
  ].join("\n");
}

/**
 * Enforced on Vercel, advisory anywhere else.
 *
 * A local build has no reason to hold the production sending key, and blocking
 * one would make the repo hard to work in. A Vercel build is the artifact that
 * takes traffic, so there the same gap is fatal.
 */
export function assertVerificationEnv(
  env: VerificationEnv,
  log: (message: string) => void = console.warn,
): void {
  const problems = [...checkVerificationEnv(env), ...checkConversionRolloutEnv(env)];
  if (problems.length === 0) return;

  const report = formatEnvProblems(problems);
  if ((env.VERCEL ?? "").trim()) throw new Error(report);
  log(`[verification-env] ${report}`);
}

/** Prevent a half-enabled rollout from disabling browser completion reporting. */
export function checkConversionRolloutEnv(env: VerificationEnv): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const publicGa = env.VITE_GA4_SERVER_CONVERSIONS_ENABLED === "true";
  const serverGa = env.WATCHDIVE_GA4_CONVERSIONS_ENABLED === "true";
  const meta = env.WATCHDIVE_META_PURCHASE_ENABLED === "true";
  if (publicGa !== serverGa)
    problems.push({
      name: "VITE_GA4_SERVER_CONVERSIONS_ENABLED / WATCHDIVE_GA4_CONVERSIONS_ENABLED",
      problem: "must be enabled together",
    });
  if (publicGa || serverGa) {
    if (!/^G-[A-Z0-9]{4,20}$/.test(present(env, "VITE_GA_MEASUREMENT_ID")))
      problems.push({ name: "VITE_GA_MEASUREMENT_ID", problem: "is missing or invalid" });
    if (!present(env, "GA4_API_SECRET"))
      problems.push({ name: "GA4_API_SECRET", problem: "is not set" });
  }
  if (meta) {
    for (const key of ["META_CAPI_ENABLED", "VITE_META_TRACKING_ENABLED"]) {
      if (env[key] !== "true")
        problems.push({ name: key, problem: "must be enabled for Meta Purchase" });
    }
    if (!present(env, "META_CAPI_ACCESS_TOKEN"))
      problems.push({ name: "META_CAPI_ACCESS_TOKEN", problem: "is not set" });
    const pixel = present(env, "META_PIXEL_ID");
    if (!/^\d{10,20}$/.test(pixel) || pixel !== present(env, "VITE_META_PIXEL_ID"))
      problems.push({
        name: "META_PIXEL_ID / VITE_META_PIXEL_ID",
        problem: "must be valid and match",
      });
  }
  if (publicGa || serverGa || meta) {
    if (!present(env, "WATCHDIVE_CONVERSION_REDIS_REST_TOKEN"))
      problems.push({ name: "WATCHDIVE_CONVERSION_REDIS_REST_TOKEN", problem: "is not set" });
    try {
      const url = new URL(present(env, "WATCHDIVE_CONVERSION_REDIS_REST_URL"));
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        throw new Error("invalid");
    } catch {
      problems.push({
        name: "WATCHDIVE_CONVERSION_REDIS_REST_URL",
        problem: "must be an HTTPS endpoint without credentials, query or fragment",
      });
    }
  }
  return problems;
}
