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
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const META_ID = /^[0-9]{4,32}$/;

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
  problems.push(...checkLaunchOsEnv(env));
  return problems;
}

function launchOsBaseUrl(raw: string): EnvProblem[] {
  const name = "LAUNCHOS_BASE_URL";
  if (!raw) return [{ name, problem: "is not set" }];
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return [{ name, problem: "is not an absolute URL" }];
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return [{ name, problem: "must be a bare https origin" }];
  }
  return [];
}

function checkExactSecret(env: VerificationEnv, name: string, minimum: number) {
  const raw = env[name] ?? "";
  if (!raw) return { name, problem: "is not set" };
  if (raw !== raw.trim()) return { name, problem: "must not contain surrounding whitespace" };
  if (Buffer.byteLength(raw, "utf8") < minimum) {
    return { name, problem: `must be at least ${minimum} bytes` };
  }
  if (raw.length > 512) return { name, problem: "must be at most 512 characters" };
  return null;
}

export function checkLaunchOsEnv(env: VerificationEnv): EnvProblem[] {
  const browserEnabled = present(env, "VITE_LAUNCHOS_MEASUREMENT_CONSENT_UI_ENABLED") === "true";
  const serverEnabled = present(env, "LAUNCHOS_MEASUREMENT_ENABLED") === "true";
  const replayEnabled = present(env, "LAUNCHOS_NOTION_REPLAY_ENABLED") === "true";
  const withdrawalEnabled = present(env, "LAUNCHOS_WITHDRAWAL_ENABLED") === "true";
  const anyEnabled = browserEnabled || serverEnabled || replayEnabled || withdrawalEnabled;
  if (!anyEnabled) return [];

  const problems: EnvProblem[] = [];
  if (!browserEnabled) {
    problems.push({
      name: "VITE_LAUNCHOS_MEASUREMENT_CONSENT_UI_ENABLED",
      problem: "must be exactly true when LaunchOS measurement is enabled",
    });
  }
  if (!serverEnabled) {
    problems.push({
      name: "LAUNCHOS_MEASUREMENT_ENABLED",
      problem: "must be exactly true with the browser consent gate",
    });
  }
  if (!replayEnabled) {
    problems.push({
      name: "LAUNCHOS_NOTION_REPLAY_ENABLED",
      problem: "must be exactly true so committed leads remain replayable",
    });
  }
  if (!withdrawalEnabled) {
    problems.push({
      name: "LAUNCHOS_WITHDRAWAL_ENABLED",
      problem: "must be exactly true so a consent withdrawal can create a suppression tombstone",
    });
  }

  problems.push(...launchOsBaseUrl(present(env, "LAUNCHOS_BASE_URL")));
  for (const [name, pattern] of [
    ["LAUNCHOS_PROJECT_ID", PROJECT_ID],
    ["LAUNCHOS_FUNNEL_VERSION", VERSION_ID],
    ["LAUNCHOS_QUALITY_RULE_VERSION", VERSION_ID],
    ["LAUNCHOS_VERIFICATION_POLICY_VERSION", VERSION_ID],
  ] as const) {
    const value = present(env, name);
    if (!value) problems.push({ name, problem: "is not set" });
    else if (!pattern.test(value))
      problems.push({ name, problem: "has an invalid exact identifier" });
  }

  const runtimeEnvironment = present(env, "LAUNCHOS_ENVIRONMENT");
  if (!/^(production|preview|development)$/.test(runtimeEnvironment)) {
    problems.push({
      name: "LAUNCHOS_ENVIRONMENT",
      problem: "must be production, preview or development",
    });
  } else if (present(env, "VERCEL_ENV") === "production" && runtimeEnvironment !== "production") {
    problems.push({
      name: "LAUNCHOS_ENVIRONMENT",
      problem: "must be exactly production when VERCEL_ENV is production",
    });
  }

  const keyNames = [
    "LAUNCHOS_WEB_EVENTS_INGRESS_KEY_ID",
    "LAUNCHOS_LEAD_STORE_INGRESS_KEY_ID",
    "LAUNCHOS_VERIFICATION_INGRESS_KEY_ID",
    "LAUNCHOS_WITHDRAWAL_INGRESS_KEY_ID",
  ] as const;
  const keyIds = keyNames.map((name) => present(env, name));
  keyNames.forEach((name, index) => {
    if (!keyIds[index]) problems.push({ name, problem: "is not set" });
    else if (!KEY_ID.test(keyIds[index])) problems.push({ name, problem: "has an invalid key id" });
  });
  if (keyIds.every(Boolean) && new Set(keyIds).size !== keyIds.length) {
    problems.push({ name: "LAUNCHOS_*_INGRESS_KEY_ID", problem: "must be distinct per source" });
  }

  const secretNames = [
    "LAUNCHOS_WEB_EVENTS_INGRESS_SECRET",
    "LAUNCHOS_LEAD_STORE_INGRESS_SECRET",
    "LAUNCHOS_VERIFICATION_INGRESS_SECRET",
    "LAUNCHOS_WITHDRAWAL_INGRESS_SECRET",
    "LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET",
    "WAITLIST_REPLAY_HMAC_SECRET",
  ] as const;
  const secrets = secretNames.map((name) => env[name] ?? "");
  secretNames.forEach((name, index) => {
    const problem = checkExactSecret(env, name, index < 4 ? 24 : 32);
    if (problem) problems.push(problem);
  });
  if (secrets.every(Boolean) && new Set(secrets).size !== secrets.length) {
    problems.push({ name: "LAUNCHOS_*_SECRET", problem: "must be distinct by purpose" });
  }

  const registryName = "LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON";
  try {
    const registry = JSON.parse(env[registryName] ?? "") as unknown;
    if (
      !Array.isArray(registry) ||
      registry.length === 0 ||
      registry.length > 10_000 ||
      registry.some(
        (entry) =>
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          Object.keys(entry).sort().join(",") !== "adId,adsetId,campaignId" ||
          !META_ID.test((entry as Record<string, string>).campaignId) ||
          !META_ID.test((entry as Record<string, string>).adsetId) ||
          !META_ID.test((entry as Record<string, string>).adId),
      )
    ) {
      throw new Error("invalid registry");
    }
  } catch {
    problems.push({
      name: registryName,
      problem: "must be a non-empty exact Meta ID triple array",
    });
  }

  const baseUrl = present(env, "LAUNCHOS_BASE_URL");
  let launchOsHostname = "";
  try {
    launchOsHostname = new URL(baseUrl).hostname;
  } catch {
    // launchOsBaseUrl already reports the malformed value above.
  }
  if (launchOsHostname.endsWith(".chatgpt.site")) {
    const sitesToken = checkExactSecret(env, "LAUNCHOS_SITES_BEARER_TOKEN", 24);
    if (sitesToken) problems.push(sitesToken);
  }
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
