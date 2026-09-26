// Build-time validation of everything the verification flow needs at runtime.
//
// Every one of these values is read on the request path. A missing signing
// secret, a Host-shaped origin, an unset Resend key: each one turns the Claim
// form into a 500 for real traffic, and each one is invisible until somebody
// submits. Checking at build time moves that discovery before the deployment
// exists rather than after it is serving.
//
// Deliberately dependency-free. This module is loaded by the Vite config, so it
// must not drag the app's module graph — or a secret — into the build tooling.
//
// Kept free of path-alias imports so `npm test` can load it directly.

export type VerificationEnv = Record<string, string | undefined>;

export type EnvProblem = { name: string; problem: string };

const MIN_SECRET_BYTES = 32;

function present(env: VerificationEnv, name: string): string {
  return (env[name] ?? "").trim();
}

/**
 * Returns every problem rather than the first, so one build surfaces the whole
 * list instead of one round trip per missing value.
 */
export function checkVerificationEnv(env: VerificationEnv): EnvProblem[] {
  const problems: EnvProblem[] = [];

  for (const name of [
    "NOTION_API_KEY",
    "NOTION_WAITLIST_DB_ID",
    "RESEND_API_KEY",
    "WATCHDIVE_EMAIL_FROM",
  ]) {
    if (!present(env, name)) problems.push({ name, problem: "is not set" });
  }

  // A sender Resend will reject is worth catching here rather than on the first
  // real signup. Both "a@b.co" and "Name <a@b.co>" are valid.
  const from = present(env, "WATCHDIVE_EMAIL_FROM");
  if (
    from &&
    !/^[^<>]*<[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+>$|^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(from)
  ) {
    problems.push({
      name: "WATCHDIVE_EMAIL_FROM",
      problem: "is not an email address or Name <address>",
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
  const problems = checkVerificationEnv(env);
  if (problems.length === 0) return;

  const report = formatEnvProblems(problems);
  if ((env.VERCEL ?? "").trim()) throw new Error(report);
  log(`[verification-env] ${report}`);
}
