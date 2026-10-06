/** Public, operator-owned attribution configuration. Never put customer data here. */
export type CompetitionAd = Readonly<{
  armId: "A" | "B" | "C";
  strategyVersion: string;
  adsetId: string;
  adId: string;
}>;

export type CompetitionRound = Readonly<{
  experimentId: string;
  roundId: string;
  campaignId: string;
  /** Inclusive UTC ISO timestamp; may explicitly precede signupStartsAt for QA. */
  captureStartsAt: string;
  /** Inclusive UTC ISO timestamp for first accepted new signups. */
  signupStartsAt: string;
  /** Exclusive signup cutoff. Do NOT add the 48-hour verification grace here. */
  signupEndsAt: string;
  ads: readonly CompetitionAd[];
}>;

/**
 * Populate from the reviewed operator-state.json before deployment. Keep prior
 * rounds for identifying expired IDs; add a fresh round rather than editing
 * an already scored mapping. An empty registry enables no competition.
 * No runtime fetch, credentials, audience membership or customer PII is needed.
 */
export const competitionRegistry: readonly CompetitionRound[] = [
  {
    "experimentId": "WD20261006",
    "roundId": "R1",
    "campaignId": "120251451099840215",
    "captureStartsAt": "2026-10-05T22:25:00Z",
    "signupStartsAt": "2026-10-05T23:30:00Z",
    "signupEndsAt": "2026-10-08T23:30:00Z",
    "ads": [
      {
        "armId": "A",
        "strategyVersion": "2",
        "adsetId": "120251451115930215",
        "adId": "120251451225930215"
      },
      {
        "armId": "A",
        "strategyVersion": "2",
        "adsetId": "120251451115930215",
        "adId": "120251451225940215"
      },
      {
        "armId": "A",
        "strategyVersion": "2",
        "adsetId": "120251451115930215",
        "adId": "120251451225950215"
      },
      {
        "armId": "A",
        "strategyVersion": "2",
        "adsetId": "120251451115930215",
        "adId": "120251451225960215"
      },
      {
        "armId": "B",
        "strategyVersion": "B-1",
        "adsetId": "120251451141410215",
        "adId": "120251451225970215"
      },
      {
        "armId": "B",
        "strategyVersion": "B-1",
        "adsetId": "120251451141410215",
        "adId": "120251451225980215"
      },
      {
        "armId": "B",
        "strategyVersion": "B-1",
        "adsetId": "120251451141410215",
        "adId": "120251451225990215"
      },
      {
        "armId": "B",
        "strategyVersion": "B-1",
        "adsetId": "120251451141410215",
        "adId": "120251451226000215"
      },
      {
        "armId": "C",
        "strategyVersion": "2",
        "adsetId": "120251451213980215",
        "adId": "120251451226010215"
      },
      {
        "armId": "C",
        "strategyVersion": "2",
        "adsetId": "120251451213980215",
        "adId": "120251451226020215"
      },
      {
        "armId": "C",
        "strategyVersion": "2",
        "adsetId": "120251451213980215",
        "adId": "120251451226030215"
      },
      {
        "armId": "C",
        "strategyVersion": "2",
        "adsetId": "120251451213980215",
        "adId": "120251451226040215"
      }
    ]
  }
];
