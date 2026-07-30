import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { LeadVerificationContext, LeadVerificationMethod } from "./funnel.functions";

const STATUS_WEBHOOK_PATH = "/api/funnel/lead-status";
const MAX_STATUS_WEBHOOK_BYTES = 16 * 1024;

const statusPayloadSchema = z
  .object({
    leadId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    method: z.enum(["email", "phone"]),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    providerEventId: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .optional(),
  })
  .strict();

type ReadLeadResult = {
  ok: boolean;
  found: boolean;
  context?: LeadVerificationContext;
};

export type LeadStatusWebhookDependencies = {
  readLead?: (args: { leadId: string }) => Promise<ReadLeadResult>;
  commitLead?: (args: {
    leadId: string;
    method: LeadVerificationMethod;
    occurredAt: string;
  }) => Promise<{ ok: boolean; found: boolean }>;
  markCrm?: (args: {
    notionPageId: string;
    method: LeadVerificationMethod;
    occurredAt: string;
  }) => Promise<void>;
  recordEvent?: (args: {
    idempotencyKey: string;
    eventName: "lead_verified";
    occurredAt: string;
    acquisitionPath: "website" | "instant_form";
    source?: string;
    attribution: LeadVerificationContext["attribution"];
    properties: Record<string, string>;
  }) => Promise<boolean>;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeTokenEqual(expected: string, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function readRequestBodyWithLimit(
  request: Request,
  limit: number,
): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function defaultReadLead(args: { leadId: string }): Promise<ReadLeadResult> {
  const { readLeadVerificationContext } = await import("./funnel.functions");
  return readLeadVerificationContext(args);
}

async function defaultCommitLead(args: {
  leadId: string;
  method: LeadVerificationMethod;
  occurredAt: string;
}): Promise<{ ok: boolean; found: boolean }> {
  const { commitLeadVerified } = await import("./funnel.functions");
  return commitLeadVerified(args);
}

async function defaultMarkCrm(args: {
  notionPageId: string;
  method: LeadVerificationMethod;
  occurredAt: string;
}): Promise<void> {
  const { markNotionLeadVerified } = await import("./waitlist.functions");
  await markNotionLeadVerified(args);
}

async function defaultRecordEvent(
  args: Parameters<NonNullable<LeadStatusWebhookDependencies["recordEvent"]>>[0],
): Promise<boolean> {
  const { recordServerFunnelEvent } = await import("./funnel.functions");
  return recordServerFunnelEvent(args);
}

/**
 * Receives a PII-free verification outcome from the email/SMS provider.
 * The high-entropy bearer secret must be configured independently from the
 * operations dashboard token.
 */
export async function handleLeadStatusWebhook(
  request: Request,
  dependencies: LeadStatusWebhookDependencies = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== STATUS_WEBHOOK_PATH) return null;
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

  const expectedToken = process.env.LEAD_STATUS_WEBHOOK_SECRET?.trim();
  if (!expectedToken) return jsonResponse(503, { error: "webhook_not_configured" });
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  if (!safeTokenEqual(expectedToken, suppliedToken)) {
    return jsonResponse(403, { error: "invalid_authorization" });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STATUS_WEBHOOK_BYTES) {
    return jsonResponse(413, { error: "payload_too_large" });
  }
  const rawBody = await readRequestBodyWithLimit(request, MAX_STATUS_WEBHOOK_BYTES);
  if (!rawBody) return jsonResponse(413, { error: "payload_too_large" });

  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }
  const parsed = statusPayloadSchema.safeParse(input);
  if (!parsed.success) return jsonResponse(400, { error: "invalid_payload" });

  const occurredAt = parsed.data.occurredAt ?? new Date().toISOString();
  const occurredAtMs = new Date(occurredAt).getTime();
  const now = Date.now();
  if (occurredAtMs > now + 10 * 60_000 || occurredAtMs < now - 365 * 24 * 60 * 60_000) {
    return jsonResponse(400, { error: "invalid_timestamp" });
  }

  const readLead = dependencies.readLead ?? defaultReadLead;
  const commitLead = dependencies.commitLead ?? defaultCommitLead;
  const markCrm = dependencies.markCrm ?? defaultMarkCrm;
  const recordEvent = dependencies.recordEvent ?? defaultRecordEvent;

  try {
    const result = await readLead({ leadId: parsed.data.leadId });
    if (!result.ok) return jsonResponse(500, { error: "measurement_storage_unavailable" });
    if (!result.found || !result.context) return jsonResponse(404, { error: "lead_not_found" });
    if (!result.context.notionPageId) {
      return jsonResponse(500, { error: "crm_link_unavailable" });
    }

    await markCrm({
      notionPageId: result.context.notionPageId,
      method: parsed.data.method,
      occurredAt,
    });
    const eventStored = await recordEvent({
      // Providers may reuse one delivery/reference id across email and phone
      // verification. Keep each method idempotent without collapsing the other.
      idempotencyKey: `lead-verification:${
        parsed.data.providerEventId ?? parsed.data.leadId
      }:${parsed.data.method}`,
      eventName: "lead_verified",
      occurredAt,
      acquisitionPath: result.context.acquisitionPath,
      source: result.context.source,
      attribution: result.context.attribution,
      properties: { verificationMethod: parsed.data.method },
    });
    if (!eventStored) return jsonResponse(500, { error: "event_storage_unavailable" });

    const committed = await commitLead({
      leadId: parsed.data.leadId,
      method: parsed.data.method,
      occurredAt,
    });
    if (!committed.ok || !committed.found) {
      return jsonResponse(500, { error: "measurement_storage_unavailable" });
    }
    return jsonResponse(200, { ok: true, updated: 1 });
  } catch {
    return jsonResponse(500, { error: "verification_update_failed" });
  }
}
