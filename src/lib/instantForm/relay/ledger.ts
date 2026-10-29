// Best-effort warm-instance defense only. The office caller owns durable claims.
const CONTACT = /@|\+[1-9][0-9]{6,}/;

const IDEMPOTENCY_KEY = /^watchdive-instant-form-[a-f0-9]{64}$/;
const LEADGEN_ID = /^[1-9][0-9]{5,19}$/;

export type LedgerEntry = {
  leadgen_id: string;
  idempotency_key: string;
  result: string;
  terminal: true;
  mail_sent: false | true;
  at: string;
};

export type ConfirmationLedger = {
  get(leadgenId: string): LedgerEntry | undefined;
  commit(entry: LedgerEntry): void;
  claim(idempotencyKey: string, leadgenId: string): boolean;
};

export function assertRedacted(value: unknown): void {
  const text = JSON.stringify(value);
  if (CONTACT.test(text)) throw new Error("ledger contains contact data");
}

function assertEntry(entry: LedgerEntry): void {
  assertRedacted(entry);
  if (entry.terminal !== true) throw new Error("ledger entry must be terminal");
  if (!IDEMPOTENCY_KEY.test(entry.idempotency_key)) throw new Error("ledger key rejected");
  if (!LEADGEN_ID.test(entry.leadgen_id)) throw new Error("ledger id rejected");
}

export function memoryLedger(seed: LedgerEntry[] = []): ConfirmationLedger {
  const rows = new Map<string, LedgerEntry>();
  const claims = new Set(seed.map((entry) => entry.idempotency_key));
  for (const entry of seed) {
    assertEntry(entry);
    rows.set(entry.leadgen_id, entry);
  }
  return {
    get: (id) => rows.get(id),
    claim(key, id) {
      if (!IDEMPOTENCY_KEY.test(key) || !LEADGEN_ID.test(id)) throw new Error("claim rejected");
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    commit(entry) {
      assertEntry(entry);
      rows.set(entry.leadgen_id, entry);
    },
  };
}

