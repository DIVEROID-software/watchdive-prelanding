/** Public, operator-reviewed campaign mapping. No credentials or customer identifiers. */
export type LandingComparisonArm = "control" | "launch";
export type LandingComparisonRun = Readonly<{
  phaseId: string;
  campaignId: string;
  captureStartsAt: string;
  /** Exclusive new paid-visit capture cutoff, normally the actual flight end. */
  captureEndsAt: string;
  signupStartsAt: string;
  /** Separate exclusive delayed-signup cutoff, e.g. flight end + 48h. */
  signupEndsAt: string;
  arms: readonly Readonly<{
    arm: LandingComparisonArm;
    adsetId: string;
    adIds: readonly string[];
  }>[];
}>;

/** Root-created paused objects; same approved KRW50,000/day per arm.
 * Root chose a bounded initial 72h pilot, not a separate owner duration reply.
 * Planned timestamps must be reconciled if the actual common start moves. */
export const landingComparisonRegistry: readonly LandingComparisonRun[] = [
  {
    phaseId: "wd-my-landing-comparison-20261105-p1",
    campaignId: "120251917620940215",
    captureStartsAt: "2026-11-06T00:30:00+09:00",
    captureEndsAt: "2026-11-09T00:30:00+09:00",
    signupStartsAt: "2026-11-06T00:30:00+09:00",
    signupEndsAt: "2026-11-11T00:30:00+09:00",
    arms: [
      {
        arm: "control",
        adsetId: "120251917621800215",
        adIds: [
          "120251917625140215",
          "120251917626650215",
          "120251917628830215",
          "120251917632610215",
        ],
      },
      {
        arm: "launch",
        adsetId: "120251917633580215",
        adIds: [
          "120251917636700215",
          "120251917639410215",
          "120251917643420215",
          "120251917650080215",
        ],
      },
    ],
  },
];
