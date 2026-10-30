// Operator-only runtime checks: credentials stay on Vercel. This endpoint
// never sends analytics, creates customers, or touches conversion event keys.
import { checkCronAuthorization } from "../verification/cronAuth.ts";
import {
  conversionCapability,
  probeConversionRest,
  readLedgerMarker,
  syntheticNamespace,
} from "./activationPreflight.ts";

type Env = Record<string, string | undefined>;
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" },
});

export async function handleConversionHealth(
  request: Request,
  options: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const runtime = options.env ?? process.env;
  if (checkCronAuthorization(request.headers.get("authorization"),
    runtime.WATCHDIVE_EXPERIMENT_REPORT_TOKEN) !== "authorized") {
    return json({ error: "unauthorized" }, 401);
  }
  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405);
  }
  const publicEnv = options.env ? {} : ((import.meta as unknown as { env?: Env }).env ?? {});
  const env = {
    ...runtime,
    VITE_GA_MEASUREMENT_ID: runtime.VITE_GA_MEASUREMENT_ID ?? publicEnv.VITE_GA_MEASUREMENT_ID,
    VITE_GA4_SERVER_CONVERSIONS_ENABLED: runtime.VITE_GA4_SERVER_CONVERSIONS_ENABLED ?? publicEnv.VITE_GA4_SERVER_CONVERSIONS_ENABLED,
  };
  const capability = conversionCapability(env);
  // Read-only epoch comparison. The value is not copied into the response.
  // GET and POST both do this. Neither creates the marker.
  const ledgerMarker = await readLedgerMarker({ env, fetchImpl: options.fetchImpl });
  const epochMatches = ledgerMarker === "matched";
  // A GET is otherwise strictly read-only. Only explicit authenticated POST runs a
  // bounded temporary-key probe with cleanup; it cannot enable the sender.
  const storeProbe = request.method === "POST"
    ? await probeConversionRest({ env, namespace: syntheticNamespace(), fetchImpl: options.fetchImpl })
    : null;
  const probePassed = Boolean(storeProbe && storeProbe.attempted &&
    storeProbe.namespaceSynthetic && !storeProbe.productionPrefixesUsed &&
    storeProbe.claimAtomic && storeProbe.readMatched && storeProbe.expiryFormAccepted &&
    storeProbe.deleted && storeProbe.leftoverCleared && storeProbe.error === null);
  return json({
    kind: "watchdive-conversion-health",
    checkedAt: new Date().toISOString(),
    sendsAnalytics: false,
    capability,
    epochPresent: capability.store.epochPresent,
    epochMatches,
    ledgerMarker,
    storeProbe,
    probePassed,
    ga4ActivationReady: capability.flags.ga4FlagsPaired && capability.ga4.apiSecretPresent &&
      capability.ga4.measurementIdShapeValid && capability.store.configured &&
      epochMatches && probePassed,
    // Neither a successful store probe nor MP HTTP acceptance proves receipt.
    actualConversionReceiptVerified: false,
  });
}
