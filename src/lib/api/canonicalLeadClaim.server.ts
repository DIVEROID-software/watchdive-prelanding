import { createHmac } from "node:crypto";

const CANONICAL_LEAD_CLAIM_RPC = "claim_canonical_lead_v1";
const SUPABASE_RPC_TIMEOUT_MS = 5_000;

export type CanonicalLeadAcquisitionPath = "website" | "instant_form";
export type CanonicalLeadEnvironment = "production" | "preview" | "development";

export type CanonicalLeadClaim = {
  owner: boolean;
  refCode: string;
  ownerAcquisitionPath: CanonicalLeadAcquisitionPath | "existing";
};

type ClaimCanonicalLeadArgs = {
  environment: CanonicalLeadEnvironment;
  canonicalEmail: string;
  acquisitionPath: CanonicalLeadAcquisitionPath;
  submissionId: string;
  candidateRefCode: string;
  existingMaster?: boolean;
  existingMasterRefCode?: string;
};

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  hmacSecret: string;
};

function supabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const hmacSecret = process.env.SIGNUP_RATE_LIMIT_HMAC_SECRET?.trim();
  if (!url || !serviceRoleKey || !hmacSecret || hmacSecret.length < 32) {
    throw new Error("Canonical lead coordination is not configured");
  }
  return { url, serviceRoleKey, hmacSecret };
}

function validateArgs(args: ClaimCanonicalLeadArgs): void {
  const hasControlCharacter = (value: string) =>
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  if (!["production", "preview", "development"].includes(args.environment)) {
    throw new Error("Invalid canonical lead environment");
  }
  if (
    !args.canonicalEmail ||
    args.canonicalEmail.length > 320 ||
    hasControlCharacter(args.canonicalEmail)
  ) {
    throw new Error("Invalid canonical lead identity");
  }
  if (args.acquisitionPath !== "website" && args.acquisitionPath !== "instant_form") {
    throw new Error("Invalid canonical lead acquisition path");
  }
  if (
    !args.submissionId ||
    args.submissionId.length > 256 ||
    hasControlCharacter(args.submissionId)
  ) {
    throw new Error("Invalid canonical lead submission");
  }
  if (!/^[a-z0-9]{8}$/.test(args.candidateRefCode)) {
    throw new Error("Invalid canonical lead ref code");
  }
  if (args.existingMasterRefCode != null && !/^[a-z0-9]{8}$/.test(args.existingMasterRefCode)) {
    throw new Error("Invalid existing canonical lead ref code");
  }
}

function keyedHash(secret: string, domain: string, value: string): string {
  return createHmac("sha256", secret)
    .update(`watchdive:${domain}:v1\u001f${value}`, "utf8")
    .digest("hex");
}

/**
 * Permanently assigns one countable owner to a canonical email. The database
 * receives only domain-separated keyed hashes; neither the email nor the
 * submission identifier crosses this boundary.
 *
 * An existing Notion master is registered under a synthetic owner so the
 * first request after migration cannot re-count a historical signup.
 */
export async function claimCanonicalLead(
  args: ClaimCanonicalLeadArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<CanonicalLeadClaim> {
  validateArgs(args);
  const config = supabaseConfig();
  const canonicalHash = keyedHash(
    config.hmacSecret,
    "canonical-lead-email",
    `${args.environment}\u001f${args.canonicalEmail}`,
  );
  const hasExistingMaster = args.existingMaster === true;
  const claimantHash = keyedHash(
    config.hmacSecret,
    hasExistingMaster ? "canonical-lead-existing-master" : "canonical-lead-submission",
    hasExistingMaster
      ? `${args.environment}\u001f${canonicalHash}`
      : `${args.environment}\u001f${args.acquisitionPath}\u001f${args.submissionId}`,
  );
  const requestedOwnerPath = hasExistingMaster ? "existing" : args.acquisitionPath;
  const requestedRefCode = args.existingMasterRefCode ?? args.candidateRefCode;

  const response = await fetchImpl(`${config.url}/rest/v1/rpc/${CANONICAL_LEAD_CLAIM_RPC}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_environment: args.environment,
      p_canonical_hash: canonicalHash,
      p_claimant_hash: claimantHash,
      p_acquisition_path: requestedOwnerPath,
      p_ref_code: requestedRefCode,
    }),
    signal: AbortSignal.timeout(SUPABASE_RPC_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Canonical lead coordination failed (${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Canonical lead coordination returned invalid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Canonical lead coordination returned an invalid response");
  }
  const record = payload as Record<string, unknown>;
  const owner = record.owner;
  const refCode = record.ref_code;
  const ownerAcquisitionPath = record.acquisition_path;
  if (
    typeof owner !== "boolean" ||
    typeof refCode !== "string" ||
    !/^[a-z0-9]{8}$/.test(refCode) ||
    (ownerAcquisitionPath !== "website" &&
      ownerAcquisitionPath !== "instant_form" &&
      ownerAcquisitionPath !== "existing")
  ) {
    throw new Error("Canonical lead coordination returned an invalid claim");
  }

  return {
    // A historical Notion master always owns the canonical identity, even
    // though the synthetic claimant was inserted by this request.
    owner: hasExistingMaster ? false : owner,
    refCode,
    ownerAcquisitionPath,
  };
}
