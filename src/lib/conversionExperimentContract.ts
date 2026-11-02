// Shared contract for the form-first conversion experiment.
//
// The browser (root-owned) and the server both speak this shape. It is safe to
// import from client code: it has no secrets, no network, and no Node APIs.
// A malformed payload is dropped. It must never fail a signup or a behavior write.
import { z } from "zod";
import { segmentContextSchema, segmentPlacementSchema } from "./segments/measurementContract.ts";

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

export const legacyExperimentContextSchema = z.object({
  experimentId: z.literal(EXPERIMENT_ID),
  variant: z.enum(EXPERIMENT_VARIANTS),
  sessionId: z.string().uuid(),
  assignedAt: z
    .number()
    .int()
    .refine((value) => Number.isSafeInteger(value) && value > 0),
  team: z.enum(EXPERIMENT_TEAMS),
  qa: z.boolean(),
  // Same per-submit snapshot as the segment context. Omitted on the session row.
  acquisitionPlacement: z.literal("entry-popup").optional(),
});

export const experimentContextSchema = z.discriminatedUnion("experimentId", [
  legacyExperimentContextSchema,
  segmentContextSchema,
]);
export type LegacyExperimentContext = z.infer<typeof legacyExperimentContextSchema>;
export type ExperimentContext = z.infer<typeof experimentContextSchema>;

/**
 * An optional object that is either valid or absent. Invalid input becomes
 * `undefined` so a bad experiment payload cannot reject the rest of the request.
 */
export function lenientOptional<S extends z.ZodTypeAny>(schema: S) {
  return z.preprocess((value) => {
    if (value == null) return undefined;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }, schema.optional());
}

/** Additive entry-popup block. It is not a body placement and not a net-new signup. */
export const POPUP_FUNNEL_VERSION = 1 as const;
export const POPUP_ACQUISITION_PLACEMENT = "entry-popup" as const;
/** First-observed client timestamps stay under this so a bad clock cannot inflate the JSON. */
export const POPUP_OBSERVED_MS_MAX = 10_000_000_000_000;
export const POPUP_MILESTONES = [
  "visible",
  "formVisible",
  "focused",
  "submitAttempted",
  "dismissed",
  "accepted",
  "failed",
  "closed",
] as const;
export type PopupMilestone = (typeof POPUP_MILESTONES)[number];
export const popupServerResultSchema = z.enum(["pending", "already_verified"]);
const popupObservedMs = z
  .number()
  .int()
  .refine((value) => Number.isSafeInteger(value) && value > 0 && value < POPUP_OBSERVED_MS_MAX);
export const popupObservedAtSchema = z
  .object({
    visible: popupObservedMs.optional(),
    formVisible: popupObservedMs.optional(),
    focused: popupObservedMs.optional(),
    submitAttempted: popupObservedMs.optional(),
    dismissed: popupObservedMs.optional(),
    accepted: popupObservedMs.optional(),
    failed: popupObservedMs.optional(),
    closed: popupObservedMs.optional(),
  })
  .strict();
export type PopupObservedAt = z.infer<typeof popupObservedAtSchema>;

function popupTimestamp(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value < POPUP_OBSERVED_MS_MAX
    ? value
    : undefined;
}

/** Keep a timestamp only for a milestone that actually happened. Never invent the flag. */
function keepPairedPopupTimestamps(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  const at = row.observedAt;
  if (at == null) return row;
  if (typeof at !== "object" || Array.isArray(at)) {
    delete row.observedAt;
    return row;
  }
  const next: PopupObservedAt = {};
  for (const key of POPUP_MILESTONES) {
    if (row[key] !== true) continue;
    const ms = popupTimestamp((at as Record<string, unknown>)[key]);
    if (ms !== undefined) next[key] = ms;
  }
  if (Object.keys(next).length > 0) row.observedAt = next;
  else delete row.observedAt;
  return row;
}

export const popupFunnelSchema = z.preprocess(
  keepPairedPopupTimestamps,
  z
    .object({
      version: z.literal(POPUP_FUNNEL_VERSION),
      placement: z.literal(POPUP_ACQUISITION_PLACEMENT),
      // The panel was on screen: nonzero, unparked, and the document was visible.
      visible: z.boolean(),
      // Email and submit passed the same hit-test as a body form. Optional so a
      // payload from before this field still parses.
      formVisible: z.boolean().optional(),
      focused: z.boolean(),
      submitAttempted: z.boolean(),
      dismissed: z.boolean(),
      // True only after the server returned pending or already_verified.
      accepted: z.boolean(),
      failed: z.boolean(),
      closed: z.boolean(),
      // pending is server-accepted pending, including an existing pending resend.
      result: popupServerResultSchema.optional(),
      // First observation only. Absent keys were not observed.
      observedAt: popupObservedAtSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.accepted !== (value.result !== undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "popup accepted and result stay paired",
        });
      }
    }),
);
export type PopupFunnel = z.infer<typeof popupFunnelSchema>;

export const experimentFunnelSchema = z.object({
  exposed: z.boolean(),
  formVisible: z.boolean(),
  formFocused: z.boolean(),
  submitAttempted: z.boolean(),
  placements: segmentPlacementSchema.optional().catch(undefined),
  // A malformed popup is omitted. It must not drop the body flags.
  popup: lenientOptional(popupFunnelSchema),
});

export type ExperimentFunnel = z.infer<typeof experimentFunnelSchema>;

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

const storedBehaviorSchema = z.discriminatedUnion("experimentId", [
  legacyExperimentContextSchema.extend({ funnel: experimentFunnelSchema.nullable() }),
  segmentContextSchema.extend({ funnel: experimentFunnelSchema.nullable() }),
]);

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
    const { funnel, ...context } = parsed.data;
    return { context, funnel, malformed: false };
  } catch {
    return { context: null, funnel: null, malformed: true };
  }
}

/** Lead-vs-session equality ignores the per-submit popup snapshot only. */
export function experimentContextIdentity(context: ExperimentContext): string {
  const { acquisitionPlacement: _placement, ...identity } = context;
  return JSON.stringify(identity);
}

function copyObservedAt(popup: PopupFunnel): PopupObservedAt | undefined {
  const raw = popup.observedAt;
  if (!raw) return undefined;
  const next: PopupObservedAt = {};
  for (const key of POPUP_MILESTONES) {
    if (popup[key] !== true) continue;
    const ms = popupTimestamp(raw[key]);
    if (ms !== undefined) next[key] = ms;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function copyPopup(popup: PopupFunnel | null | undefined): PopupFunnel | undefined {
  if (!popup) return undefined;
  const accepted = popup.accepted === true;
  const result =
    accepted && (popup.result === "pending" || popup.result === "already_verified")
      ? popup.result
      : undefined;
  if (accepted !== (result !== undefined)) return undefined;
  const copied: PopupFunnel = {
    version: POPUP_FUNNEL_VERSION,
    placement: POPUP_ACQUISITION_PLACEMENT,
    visible: popup.visible === true,
    formVisible: popup.formVisible === true,
    focused: popup.focused === true,
    submitAttempted: popup.submitAttempted === true,
    dismissed: popup.dismissed === true,
    accepted,
    failed: popup.failed === true,
    closed: popup.closed === true,
    ...(result ? { result } : {}),
  };
  const observedAt = copyObservedAt({ ...copied, observedAt: popup.observedAt });
  return observedAt ? { ...copied, observedAt } : copied;
}

function unionPopup(
  rows: Array<ExperimentFunnel | null | undefined>,
): PopupFunnel | undefined {
  const present = rows
    .map((row) => copyPopup(row?.popup))
    .filter((popup): popup is PopupFunnel => Boolean(popup));
  if (present.length === 0) return undefined;
  const result = present.some((popup) => popup.result === "already_verified")
    ? "already_verified"
    : present.some((popup) => popup.result === "pending")
      ? "pending"
      : undefined;
  const observedAt: PopupObservedAt = {};
  for (const key of POPUP_MILESTONES) {
    let earliest: number | undefined;
    for (const popup of present) {
      const ms = popup.observedAt?.[key];
      if (ms == null) continue;
      if (earliest == null || ms < earliest) earliest = ms;
    }
    if (earliest !== undefined) observedAt[key] = earliest;
  }
  return {
    version: POPUP_FUNNEL_VERSION,
    placement: POPUP_ACQUISITION_PLACEMENT,
    visible: present.some((popup) => popup.visible),
    formVisible: present.some((popup) => popup.formVisible === true),
    focused: present.some((popup) => popup.focused),
    submitAttempted: present.some((popup) => popup.submitAttempted),
    dismissed: present.some((popup) => popup.dismissed),
    accepted: present.some((popup) => popup.accepted),
    failed: present.some((popup) => popup.failed),
    closed: present.some((popup) => popup.closed),
    ...(result ? { result } : {}),
    ...(Object.keys(observedAt).length > 0 ? { observedAt } : {}),
  };
}

export type PopupFunnelCounts = {
  visible: number;
  formVisible: number;
  focused: number;
  submitAttempted: number;
  dismissed: number;
  accepted: number;
  failed: number;
  closed: number;
  pending: number;
  alreadyVerified: number;
};

export function emptyPopupCounts(): PopupFunnelCounts {
  return {
    visible: 0,
    formVisible: 0,
    focused: 0,
    submitAttempted: 0,
    dismissed: 0,
    accepted: 0,
    failed: 0,
    closed: 0,
    pending: 0,
    alreadyVerified: 0,
  };
}

/** Count one session. pending is not a net-new person. Verified wins over pending. */
export function countPopupSession(
  funnel: ExperimentFunnel | null | undefined,
  into: PopupFunnelCounts,
): boolean {
  const popup = funnel?.popup;
  if (!popup) return false;
  if (popup.visible) into.visible++;
  if (popup.formVisible) into.formVisible++;
  if (popup.focused) into.focused++;
  if (popup.submitAttempted) into.submitAttempted++;
  if (popup.dismissed) into.dismissed++;
  if (popup.accepted) into.accepted++;
  if (popup.failed) into.failed++;
  if (popup.closed) into.closed++;
  if (popup.result === "already_verified") into.alreadyVerified++;
  else if (popup.result === "pending") into.pending++;
  return true;
}

/**
 * One row's flags, exactly as stored. Focus does not prove the form was
 * visible, a submit does not prove focus, and a later step does not invent
 * `exposed`. A saved email is not a funnel event. Popup flags stay in their
 * own block and do not fill the body flags.
 */
export function monotonicFunnel(funnel: ExperimentFunnel | null | undefined): ExperimentFunnel {
  const popup = copyPopup(funnel?.popup);
  return {
    exposed: funnel?.exposed === true,
    formVisible: funnel?.formVisible === true,
    formFocused: funnel?.formFocused === true,
    submitAttempted: funnel?.submitAttempted === true,
    ...(popup ? { popup } : {}),
  };
}

/** OR each flag across rows. Duplicate cold starts stay one session without filling gaps. */
export function unionFunnels(rows: Array<ExperimentFunnel | null | undefined>): ExperimentFunnel {
  const popup = unionPopup(rows);
  return {
    exposed: rows.some((row) => row?.exposed === true),
    formVisible: rows.some((row) => row?.formVisible === true),
    formFocused: rows.some((row) => row?.formFocused === true),
    submitAttempted: rows.some((row) => row?.submitAttempted === true),
    ...(popup ? { popup } : {}),
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
