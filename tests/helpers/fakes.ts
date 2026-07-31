// In-memory doubles for the verification flow. Nothing here touches a network.
import type {
  CreatePendingInput,
  LeadRecord,
  LeadStore,
  MarkSentInput,
  MarkVerifiedInput,
  MarkWelcomeInput,
  StartAttemptInput,
} from "../../src/lib/verification/contracts.ts";
import type {
  VerificationMail,
  VerificationMailer,
  WelcomeMail,
} from "../../src/lib/verification/resend.ts";
import { verificationUrl } from "../../src/lib/verification/token.ts";

export const TEST_SECRET = "test-verification-secret-at-least-32b";
export const TEST_ORIGIN = "https://watchdive.diveroid.com";

export const TEST_ENV = {
  WATCHDIVE_VERIFICATION_SECRET: TEST_SECRET,
  WATCHDIVE_PUBLIC_ORIGIN: TEST_ORIGIN,
};

let pageCounter = 0;

export function nextPageId(): string {
  pageCounter += 1;
  return `page-${pageCounter}`;
}

/** Deterministic lead ids so tests can name an attempt. */
export function leadIdFactory(prefix = 0): () => string {
  let n = prefix;
  return () => {
    n += 1;
    return `aaaaaaaa-bbbb-4ccc-8ddd-${n.toString(16).padStart(12, "0")}`;
  };
}

export class FakeLeadStore implements LeadStore {
  rows = new Map<string, LeadRecord>();
  byCanonical = new Map<string, string>();
  /** Attribution is written once and never read back, so the call is the record. */
  createPendingInputs: CreatePendingInput[] = [];
  markVerifiedCalls = 0;
  startAttemptCalls = 0;
  markSentCalls = 0;
  markWelcomeCalls = 0;
  /** Lets a test simulate a racing confirmation landing between write and read. */
  onMarkVerified?: (pageId: string, input: MarkVerifiedInput) => void;

  seed(record: Partial<LeadRecord> & { email: string; canonical: string }): LeadRecord {
    const row: LeadRecord = {
      pageId: record.pageId ?? nextPageId(),
      email: record.email,
      status: record.status ?? "pending",
      emailVerified: record.emailVerified ?? false,
      refCode: record.refCode ?? "seedcode",
      source: record.source ?? "hero",
      suspect: record.suspect ?? false,
      flags: record.flags ?? [],
      phone: record.phone ?? "",
      leadId: record.leadId ?? "",
      metaEventId: record.metaEventId ?? "",
      sends: record.sends ?? 0,
      ...(record.sentAt ? { sentAt: record.sentAt } : {}),
      ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
      ...(record.verifiedAt ? { verifiedAt: record.verifiedAt } : {}),
      ...(record.welcomeAt ? { welcomeAt: record.welcomeAt } : {}),
    };
    this.rows.set(row.pageId, row);
    this.byCanonical.set(record.canonical, row.pageId);
    return row;
  }

  async findByEmail(canonical: string): Promise<LeadRecord | undefined> {
    const pageId = this.byCanonical.get(canonical);
    return pageId ? this.rows.get(pageId) : undefined;
  }

  async findByLeadId(leadId: string): Promise<LeadRecord | undefined> {
    if (!leadId) return undefined;
    for (const row of this.rows.values()) if (row.leadId === leadId) return row;
    return undefined;
  }

  async createPending(input: CreatePendingInput): Promise<LeadRecord> {
    this.createPendingInputs.push(input);
    return this.seed({
      email: input.email,
      canonical: input.canonical,
      status: "pending",
      refCode: input.refCode,
      source: input.source,
      suspect: input.suspect,
      flags: input.flags,
      phone: input.phone ?? "",
      leadId: input.leadId,
      expiresAt: input.expiresAt,
      sends: 1,
    });
  }

  async startAttempt(pageId: string, input: StartAttemptInput): Promise<void> {
    this.startAttemptCalls += 1;
    const row = this.rows.get(pageId);
    if (!row) return;
    this.rows.set(pageId, {
      ...row,
      status: "pending",
      leadId: input.leadId,
      expiresAt: input.expiresAt,
      sends: input.sends,
    });
  }

  async markSent(pageId: string, input: MarkSentInput): Promise<void> {
    this.markSentCalls += 1;
    const row = this.rows.get(pageId);
    if (row) this.rows.set(pageId, { ...row, sentAt: input.sentAt });
  }

  async markVerified(pageId: string, input: MarkVerifiedInput): Promise<void> {
    this.markVerifiedCalls += 1;
    const row = this.rows.get(pageId);
    if (!row) return;
    this.rows.set(pageId, {
      ...row,
      status: "verified",
      emailVerified: true,
      verifiedAt: input.verifiedAt,
      metaEventId: input.metaEventId,
    });
    this.onMarkVerified?.(pageId, input);
  }

  async markWelcomeScheduled(pageId: string, input: MarkWelcomeInput): Promise<void> {
    this.markWelcomeCalls += 1;
    const row = this.rows.get(pageId);
    if (row) this.rows.set(pageId, { ...row, welcomeAt: input.scheduledAt });
  }

  async reread(pageId: string): Promise<LeadRecord | undefined> {
    return this.rows.get(pageId);
  }
}

export class FakeMailer implements VerificationMailer {
  sent: VerificationMail[] = [];
  welcomes: WelcomeMail[] = [];
  fail = false;
  failWelcome = false;

  async send(input: VerificationMail): Promise<void> {
    if (this.fail) throw new Error("Resend delivery failed (503)");
    this.sent.push(input);
  }

  async sendWelcome(input: WelcomeMail): Promise<void> {
    if (this.failWelcome) throw new Error("Resend delivery failed (503)");
    this.welcomes.push(input);
  }

  /** Fails every send until cleared, for provider-outage paths. */
  get lastUrl(): string | undefined {
    const last = this.sent[this.sent.length - 1];
    if (!last) return undefined;
    return verificationUrl(last.publicOrigin, last.token);
  }
}
