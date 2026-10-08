// Shared contract for the form-first conversion experiment.
//
// The browser (root-owned) and the server both speak this shape. It is safe to
// import from client code: it has no secrets, no network, and no Node APIs.
// A malformed payload is dropped. It must never fail a signup or a behavior write.
import { z } from "zod";

export const EXPERIMENT_ID = "wd-form-first-20261008" as const;

export const EXPERIMENT_VARIANTS = ["control", "form_first"] as const;
export const EXPERIMENT_TEAMS = ["A", "B", "C", "D", "E", "organic"] as const;

/** Rich-text CRM column. Optional until provisioned. A missing column must not reject a signup. */
export const FIELD_CONVERSION_EXPERIMENT = "Conversion experiment";

/**
 * Marker inside the existing Sections rich text. The UX database has no spare
 * column; the readable section list stays in front of this marker.
 */
export const EXPERIMENT_SECTION_MARKER = "[[wd-exp]]";

/** Notion rich_text is capped at 2,000. Stay under it so the marker is never sliced off. */
export const SECTIONS_TEXT_MAX = 1_900;

/** A verified email counts for the experiment only inside this window after first exposure. */
export const EXPERIMENT_MATURITY_MS = 48 * 60 * 60 * 1000;

export const experimentContextSchema = z.object({
  experimentId: z.literal(EXPERIMENT_ID),
  variant: z.enum(EXPERIMENT_VARIANTS),
  sessionId: z.string().uuid(),
  assignedAt: z.number().int().refine((value) => Number.isSafeInteger(value) && value > 0),
  team: z.enum(EXPERIMENT_TEAMS),
  qa: z.boolean(),
});

export type ExperimentContext = z.infer<typeof experimentContextSchema>;

export const experimentFunnelSchema = z.object({
  exposed: z.boolean(),
  formVisible: z.boolean(),
  formFocused: z.boolean(),
  submitAttempted: z.boolean(),
});

export type ExperimentFunnel = z.infer<typeof experimentFunnelSchema>;

/**
 * An optional object that is either valid or absent. Invalid input becomes
 * `undefined` so a bad experiment payload cannot reject the rest of the request.
 */
export function lenientOptional<T>(schema: z.ZodType<T>) {
  return z.preprocess((value) => {
    if (value == null) return undefined;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }, schema.optional());
}

export type ExperimentPersistGate = {
  measurementConsent: boolean;
  suspect: boolean;
  blocked: boolean;
};

/**
 * Lead context is written only for a new, measurable, non-suspect signup.
 * QA rows may be stored (the report drops them). Repeats never reach this helper.
 */
export function persistableExperimentContext(
  raw: unknown,
  gate: ExperimentPersistGate,
): ExperimentContext | undefined {
  if (!gate.measurementConsent || gate.suspect || gate.blocked) return undefined;
  if (raw == null) return undefined;
  const parsed = experimentContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

const storedBehaviorSchema = experimentContextSchema.and(
  z.object({ funnel: experimentFunnelSchema.nullable() }),
);

export type StoredBehaviorExperiment = z.infer<typeof storedBehaviorSchema>;

export function encodeLeadExperiment(context: ExperimentContext): string | null {
  const parsed = experimentContextSchema.safeParse(context);
  if (!parsed.success) return null;
  const json = JSON.stringify(parsed.data);
  return json.length <= SECTIONS_TEXT_MAX ? json : null;
}

export function parseLeadExperiment(raw: string): {
  context: ExperimentContext | null;
  malformed: boolean;
} {
  const text = raw.trim();
  if (!text) return { context: null, malformed: false };
  try {
    const parsed = experimentContextSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { context: null, malformed: true };
    return { context: parsed.data, malformed: false };
  } catch {
    return { context: null, malformed: true };
  }
}

/**
 * Legacy section text, then one line the report can find. The JSON is kept
 * whole: if it cannot fit, the experiment is omitted rather than truncated
 * into something the parser would have to guess at.
 */
export function encodeBehaviorSections(
  legacy: string,
  experiment?: ExperimentContext,
  funnel?: ExperimentFunnel,
): string {
  const headroom = legacy.slice(0, 1_800);
  if (!experiment) return headroom;
  const parsedFunnel = funnel ? experimentFunnelSchema.safeParse(funnel) : undefined;
  const payload: StoredBehaviorExperiment = {
    ...experiment,
    funnel: parsedFunnel?.success ? parsedFunnel.data : null,
  };
  const stored = storedBehaviorSchema.safeParse(payload);
  if (!stored.success) return headroom;
  const suffix = `${EXPERIMENT_SECTION_MARKER}${JSON.stringify(stored.data)}`;
  if (suffix.length > 1_800) return headroom;
  const room = SECTIONS_TEXT_MAX - suffix.length - 1;
  const head = headroom.slice(0, Math.max(0, room)).replace(/\s+$/u, "");
  const combined = head ? `${head}\n${suffix}` : suffix;
  return combined.length <= SECTIONS_TEXT_MAX ? combined : suffix;
}

export function parseBehaviorSections(raw: string): {
  context: ExperimentContext | null;
  funnel: ExperimentFunnel | null;
  malformed: boolean;
} {
  const text = raw ?? "";
  const at = text.indexOf(EXPERIMENT_SECTION_MARKER);
  if (at < 0) return { context: null, funnel: null, malformed: false };
  const json = text.slice(at + EXPERIMENT_SECTION_MARKER.length).trim();
  try {
    const parsed = storedBehaviorSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return { context: null, funnel: null, malformed: true };
    return { context: parsed.data, funnel: parsed.data.funnel, malformed: false };
  } catch {
    return { context: null, funnel: null, malformed: true };
  }
}

/**
 * One row's flags, exactly as stored. Focus does not prove the form was
 * visible, a submit does not prove focus, and a later step does not invent
 * `exposed`. A saved email is not a funnel event.
 */
export function monotonicFunnel(funnel: ExperimentFunnel | null | undefined): ExperimentFunnel {
  return {
    exposed: funnel?.exposed === true,
    formVisible: funnel?.formVisible === true,
    formFocused: funnel?.formFocused === true,
    submitAttempted: funnel?.submitAttempted === true,
  };
}

/** OR each flag across rows. Duplicate cold starts stay one session without filling gaps. */
export function unionFunnels(rows: Array<ExperimentFunnel | null | undefined>): ExperimentFunnel {
  return {
    exposed: rows.some((row) => row?.exposed === true),
    formVisible: rows.some((row) => row?.formVisible === true),
    formFocused: rows.some((row) => row?.formFocused === true),
    submitAttempted: rows.some((row) => row?.submitAttempted === true),
  };
}

/** A later observed step without the earlier one. Counted, never filled in. */
export function milestoneGap(funnel: ExperimentFunnel): boolean {
  return (
    (funnel.formVisible && !funnel.exposed) ||
    (funnel.formFocused && !funnel.formVisible) ||
    (funnel.submitAttempted && !funnel.formFocused)
  );
}
