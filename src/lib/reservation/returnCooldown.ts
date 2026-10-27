// One return-link send per lead per 23-hour rate window.
// On Vercel this is process memory only. The disk file is a local hint and is
// not durable there. The cross-instance guarantee is the provider idempotency
// key, which stays the same for the whole window.
// The file is a sibling of the campaign receipt log, never a line inside it.
// A foreign line in the campaign log makes that job refuse to send.
// Lines hold a lead id and a window bucket. No address, token, or URL.
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { isLeadId } from "../verification/token.ts";
import { acquireReceiptLock, releaseReceiptLock } from "../reservation-mail/receipts.ts";

export type ReturnCooldown = {
  alreadySent(leadId: string, bucket: number): Promise<boolean>;
  remember(leadId: string, bucket: number, atIso: string): Promise<void>;
};

const FILE_NAME = "wd-reservation-return-v1.jsonl";
const LOCK_NAME = "wd-reservation-return-v1.lock";

type CooldownLine = { v: 1; leadId: string; bucket: number; at: string };

export function createMemoryReturnCooldown(): ReturnCooldown {
  const seen = new Set<string>();
  return {
    async alreadySent(leadId, bucket) {
      return seen.has(keyOf(leadId, bucket));
    },
    async remember(leadId, bucket) {
      seen.add(keyOf(leadId, bucket));
    },
  };
}

export function returnCooldownFile(dir: string): string {
  return join(resolve(dir), FILE_NAME);
}

export function createFileReturnCooldown(dir: string): ReturnCooldown {
  const file = returnCooldownFile(dir);
  const lock = join(resolve(dir), LOCK_NAME);
  return {
    async alreadySent(leadId, bucket) {
      const wanted = keyOf(leadId, bucket);
      let raw = "";
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return false;
        throw error;
      }
      for (const line of raw.split("\n")) {
        const parsed = parseCooldownLine(line);
        if (parsed && keyOf(parsed.leadId, parsed.bucket) === wanted) return true;
      }
      return false;
    },
    async remember(leadId, bucket, atIso) {
      const record: CooldownLine = {
        v: 1,
        leadId: leadId.toLowerCase(),
        bucket,
        at: atIso,
      };
      const line = `${JSON.stringify(record)}\n`;
      assertCooldownLineSafe(line);
      if (!parseCooldownLine(line)) throw new Error("Unsafe return cooldown");
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await acquireReceiptLock(lock);
      try {
        const handle = await open(file, "a", 0o600);
        try {
          await handle.write(line);
          await handle.sync();
        } finally {
          await handle.close();
        }
      } finally {
        await releaseReceiptLock(lock);
      }
    },
  };
}

/** Memory first, then the file when a directory is configured. A file write failure stays in memory. */
export function createReturnCooldown(dir?: string): ReturnCooldown {
  const memory = createMemoryReturnCooldown();
  const trimmed = dir?.trim() ?? "";
  if (!trimmed) return memory;
  const file = createFileReturnCooldown(trimmed);
  return {
    async alreadySent(leadId, bucket) {
      if (await memory.alreadySent(leadId, bucket)) return true;
      try {
        return await file.alreadySent(leadId, bucket);
      } catch {
        return false;
      }
    },
    async remember(leadId, bucket, atIso) {
      await memory.remember(leadId, bucket, atIso);
      try {
        await file.remember(leadId, bucket, atIso);
      } catch {
        // The provider key still collapses a replay inside this window.
      }
    },
  };
}

function keyOf(leadId: string, bucket: number): string {
  return `${leadId.toLowerCase()}:${bucket}`;
}

function assertCooldownLineSafe(line: string): void {
  if (/@|token=|invite=|https?:\/\//i.test(line)) throw new Error("Unsafe return cooldown");
}

function parseCooldownLine(line: string): CooldownLine | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    assertCooldownLineSafe(trimmed);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Partial<CooldownLine>;
  if (record.v !== 1 || typeof record.leadId !== "string" || !isLeadId(record.leadId)) return undefined;
  if (typeof record.bucket !== "number" || !Number.isSafeInteger(record.bucket) || record.bucket < 0) {
    return undefined;
  }
  if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) return undefined;
  return { v: 1, leadId: record.leadId.toLowerCase(), bucket: record.bucket, at: record.at };
}
