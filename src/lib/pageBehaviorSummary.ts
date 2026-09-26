import { z } from "zod";

import { SUPPORTED_LOCALES } from "./i18n/locale.ts";

const safeId = /^[a-z0-9-]{1,40}$/;
const safeLabel = /^[\p{L}\p{N} _-]{1,40}$/u;
const safeToken = /^[A-Za-z0-9._-]{0,40}$/;
const safeHost = /^[a-z0-9.-]{0,80}$/;
const safeZone = /^[A-Za-z0-9_+\-/]{1,64}$/;

function noContact(value: string): boolean {
  return !value.includes("@") && !/https?:/i.test(value) && !/\d{8,}/.test(value);
}

const sectionSchema = z.object({
  id: z.string().regex(safeLabel).refine(noContact),
  dwellSec: z.number().int().min(0).max(86_400),
});

const clickSchema = z.object({
  id: z.string().regex(safeId).refine(noContact),
  x: z.number().int().min(0).max(100),
  y: z.number().int().min(0).max(100),
});

export const pageBehaviorSummarySchema = z.object({
  sessionId: z.string().uuid(),
  locale: z.enum(SUPPORTED_LOCALES),
  device: z.enum(["phone", "tablet", "desktop"]),
  viewportW: z.number().int().min(0).max(8_000),
  viewportH: z.number().int().min(0).max(8_000),
  timezone: z.string().regex(safeZone),
  durationSec: z.number().int().min(0).max(86_400),
  maxScroll: z.number().int().min(0).max(100),
  referrerHost: z.string().regex(safeHost),
  utmSource: z.string().regex(safeToken),
  utmMedium: z.string().regex(safeToken),
  utmCampaign: z.string().regex(safeToken),
  sections: z.array(sectionSchema).max(16),
  clicks: z.array(clickSchema).max(30),
});

export type PageBehaviorSummary = z.infer<typeof pageBehaviorSummarySchema>;

export function countryFromHeader(value: string | null | undefined): string {
  const code = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
