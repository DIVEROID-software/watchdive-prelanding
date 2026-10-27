import type { Locale } from "../i18n/locale.ts";
import { isLocale } from "../i18n/locale.ts";
import { PUSH_COPY_VERSION } from "./config.ts";
import { decryptSubscription, encryptSubscription } from "./crypto.server.ts";
import { PUSH_KEY_VERSION, PUSH_PROPERTIES, PUSH_STATUSES, type PushStatus } from "./schema.ts";
import type { StoredPushSubscription } from "./store.server.ts";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const NOTION_VERSION = "2022-06-28";

export class PushStoreError extends Error {
  status: number;
  constructor(status: number) {
    super("push_store_failed");
    this.status = status;
  }
}

export type PushNotionRequest = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

export function createPushNotionRequest(fetchImpl: typeof fetch, token: string): PushNotionRequest {
  return async (method, path, body) => {
    if (!token || path.startsWith("/") || path.includes(".."))
      throw new Error("push_notion_request");
    const response = await fetchImpl(`https://api.notion.com/v1/${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.text().catch(() => "");
      throw new PushStoreError(response.status);
    }
    return (await response.json()) as Record<string, unknown>;
  };
}

export type ListedPushSubscription = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
  locale: Locale;
  receipt: string;
};

export type PushRetentionRow = {
  id: string;
  status: PushStatus;
  expiresAt: string | null;
  updatedAt: string | null;
};

export type PushSendGate = {
  status: string;
  consent: string;
  receipt: string;
};

export type PushDirectory = {
  put(id: string, subscription: StoredPushSubscription): Promise<void>;
  remove(id: string): Promise<void>;
  listActive(): Promise<{
    subscriptions: ListedPushSubscription[];
    undecryptable: number;
    truncated: boolean;
  }>;
  getReceipt(id: string): Promise<string>;
  setReceipt(id: string, receipt: string): Promise<void>;
  setStatus(id: string, status: PushStatus, archive: boolean): Promise<void>;
  /** Fresh status, consent, and receipt. Null means the row is gone. */
  readGate(id: string): Promise<PushSendGate | null>;
  listRetentionRows(): Promise<{ rows: PushRetentionRow[]; truncated: boolean }>;
};

type NotionPage = {
  id: string;
  created_time: string;
  properties: Record<string, unknown>;
};

function richText(value: string) {
  if (!value) return { rich_text: [] as { type: "text"; text: { content: string } }[] };
  const chunks = [];
  for (let index = 0; index < value.length; index += 1900) {
    chunks.push({ type: "text" as const, text: { content: value.slice(index, index + 1900) } });
  }
  return { rich_text: chunks };
}

function plain(property: unknown, key: "title" | "rich_text"): string {
  const items = (property as Record<string, { plain_text?: string }[] | undefined> | undefined)?.[
    key
  ];
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => (typeof item?.plain_text === "string" ? item.plain_text : ""))
    .join("");
}

function selectName(property: unknown): string {
  const name = (property as { select?: { name?: unknown } } | undefined)?.select?.name;
  return typeof name === "string" ? name : "";
}

function dateStart(property: unknown): string | null {
  const start = (property as { date?: { start?: unknown } | null } | undefined)?.date?.start;
  return typeof start === "string" ? start : null;
}

function asPage(value: unknown): NotionPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as {
    id?: unknown;
    created_time?: unknown;
    archived?: unknown;
    in_trash?: unknown;
    properties?: unknown;
  };
  if (page.archived === true || page.in_trash === true) return null;
  if (typeof page.id !== "string" || !/^[0-9a-f-]{32,36}$/i.test(page.id)) return null;
  if (
    typeof page.created_time !== "string" ||
    !page.properties ||
    typeof page.properties !== "object"
  )
    return null;
  return {
    id: page.id,
    created_time: page.created_time,
    properties: page.properties as Record<string, unknown>,
  };
}

function canonical(pages: NotionPage[]): NotionPage | null {
  if (pages.length === 0) return null;
  return (
    [...pages].sort(
      (left, right) =>
        left.created_time.localeCompare(right.created_time) || left.id.localeCompare(right.id),
    )[0] ?? null
  );
}

function assertId(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("push_id");
}

export function createNotionPushStore(input: {
  request: PushNotionRequest;
  databaseId: string;
  encryptionSecret: string;
  now?: () => Date;
}): PushDirectory {
  const now = input.now ?? (() => new Date());
  const queryPath = `databases/${encodeURIComponent(input.databaseId)}/query`;

  async function query(
    body: Record<string, unknown>,
    cap = 1,
  ): Promise<{
    pages: NotionPage[];
    truncated: boolean;
  }> {
    const pages: NotionPage[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < cap; page++) {
      const response = await input.request("POST", queryPath, {
        ...body,
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      const batch = Array.isArray(response.results) ? response.results : [];
      for (const item of batch) {
        const parsed = asPage(item);
        if (parsed) pages.push(parsed);
      }
      if (response.has_more !== true) return { pages, truncated: false };
      if (typeof response.next_cursor !== "string" || response.next_cursor.length === 0) {
        return { pages, truncated: true };
      }
      cursor = response.next_cursor;
    }
    return { pages, truncated: true };
  }

  async function pagesFor(id: string): Promise<NotionPage[]> {
    assertId(id);
    const { pages, truncated } = await query(
      { filter: { property: PUSH_PROPERTIES.id, title: { equals: id } } },
      1,
    );
    if (truncated) throw new PushStoreError(409);
    return pages;
  }

  async function patch(page: NotionPage, properties: Record<string, unknown>, archive = false) {
    await input.request("PATCH", `pages/${encodeURIComponent(page.id)}`, {
      ...(archive ? { archived: true } : {}),
      properties,
    });
  }

  function subscriptionProperties(
    id: string,
    subscription: StoredPushSubscription,
    ciphertext: string,
  ) {
    return {
      [PUSH_PROPERTIES.id]: { title: [{ type: "text", text: { content: id } }] },
      [PUSH_PROPERTIES.status]: { select: { name: "active" } },
      [PUSH_PROPERTIES.locale]: { select: { name: subscription.locale } },
      [PUSH_PROPERTIES.consentVersion]: richText(subscription.consentVersion),
      [PUSH_PROPERTIES.consentAt]: { date: { start: subscription.consentAt } },
      [PUSH_PROPERTIES.expiresAt]: {
        date:
          subscription.expirationTime == null
            ? null
            : { start: new Date(subscription.expirationTime).toISOString() },
      },
      [PUSH_PROPERTIES.ciphertext]: richText(ciphertext),
      [PUSH_PROPERTIES.keyVersion]: richText(PUSH_KEY_VERSION),
      [PUSH_PROPERTIES.updatedAt]: { date: { start: now().toISOString() } },
    };
  }

  return {
    async put(id, subscription) {
      if (input.encryptionSecret.length < 32) throw new Error("push_encryption_secret");
      const ciphertext = encryptSubscription(input.encryptionSecret, id, {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expirationTime: subscription.expirationTime,
      });
      const properties = subscriptionProperties(id, subscription, ciphertext);
      let pages = await pagesFor(id);
      if (pages.length === 0) {
        await input.request("POST", "pages", {
          parent: { database_id: input.databaseId },
          properties: { ...properties, [PUSH_PROPERTIES.campaignReceipt]: richText("") },
        });
        pages = await pagesFor(id);
      }
      const keeper = canonical(pages);
      if (!keeper) throw new PushStoreError(409);
      await patch(keeper, properties, false);
      for (const extra of pages) {
        if (extra.id === keeper.id) continue;
        await patch(
          extra,
          {
            [PUSH_PROPERTIES.status]: { select: { name: "revoked" } },
            [PUSH_PROPERTIES.updatedAt]: { date: { start: now().toISOString() } },
          },
          true,
        );
      }
    },
    async remove(id) {
      await this.setStatus(id, "revoked", true);
    },
    async listActive() {
      const { pages, truncated } = await query(
        {
          filter: { property: PUSH_PROPERTIES.status, select: { equals: "active" } },
          sorts: [{ timestamp: "created_time", direction: "ascending" }],
        },
        MAX_PAGES,
      );
      if (truncated) return { subscriptions: [], undecryptable: 0, truncated: true };
      const subscriptions: ListedPushSubscription[] = [];
      let undecryptable = 0;
      for (const page of pages) {
        const id = plain(page.properties[PUSH_PROPERTIES.id], "title");
        const locale = selectName(page.properties[PUSH_PROPERTIES.locale]);
        const consent = plain(page.properties[PUSH_PROPERTIES.consentVersion], "rich_text");
        const keyVersion = plain(page.properties[PUSH_PROPERTIES.keyVersion], "rich_text");
        const packed = plain(page.properties[PUSH_PROPERTIES.ciphertext], "rich_text");
        if (
          !/^[a-f0-9]{64}$/.test(id) ||
          !isLocale(locale) ||
          consent !== PUSH_COPY_VERSION ||
          keyVersion !== PUSH_KEY_VERSION
        ) {
          undecryptable++;
          continue;
        }
        try {
          const secret = decryptSubscription(input.encryptionSecret, id, packed);
          subscriptions.push({
            id,
            endpoint: secret.endpoint,
            keys: { p256dh: secret.p256dh, auth: secret.auth },
            expirationTime: secret.expirationTime,
            locale,
            receipt: plain(page.properties[PUSH_PROPERTIES.campaignReceipt], "rich_text"),
          });
        } catch {
          undecryptable++;
        }
      }
      return { subscriptions, undecryptable, truncated: false };
    },
    async getReceipt(id) {
      const keeper = canonical(await pagesFor(id));
      if (!keeper) return "";
      return plain(keeper.properties[PUSH_PROPERTIES.campaignReceipt], "rich_text");
    },
    async readGate(id) {
      const keeper = canonical(await pagesFor(id));
      if (!keeper) return null;
      return {
        status: selectName(keeper.properties[PUSH_PROPERTIES.status]),
        consent: plain(keeper.properties[PUSH_PROPERTIES.consentVersion], "rich_text"),
        receipt: plain(keeper.properties[PUSH_PROPERTIES.campaignReceipt], "rich_text"),
      };
    },
    async setReceipt(id, receipt) {
      const keeper = canonical(await pagesFor(id));
      if (!keeper) throw new PushStoreError(404);
      await patch(keeper, {
        [PUSH_PROPERTIES.campaignReceipt]: richText(receipt),
        [PUSH_PROPERTIES.updatedAt]: { date: { start: now().toISOString() } },
      });
    },
    async setStatus(id, status, archive) {
      if (!PUSH_STATUSES.includes(status)) throw new Error("push_status");
      const pages = await pagesFor(id);
      const targets = archive ? pages : canonical(pages) ? [canonical(pages)!] : [];
      for (const page of targets) {
        await patch(
          page,
          {
            [PUSH_PROPERTIES.status]: { select: { name: status } },
            [PUSH_PROPERTIES.updatedAt]: { date: { start: now().toISOString() } },
          },
          archive,
        );
      }
    },
    async listRetentionRows() {
      const { pages, truncated } = await query(
        { sorts: [{ timestamp: "created_time", direction: "ascending" }] },
        MAX_PAGES,
      );
      const rows: PushRetentionRow[] = [];
      for (const page of pages) {
        const id = plain(page.properties[PUSH_PROPERTIES.id], "title");
        const status = selectName(page.properties[PUSH_PROPERTIES.status]);
        if (!/^[a-f0-9]{64}$/.test(id) || !PUSH_STATUSES.includes(status as PushStatus)) continue;
        rows.push({
          id,
          status: status as PushStatus,
          expiresAt: dateStart(page.properties[PUSH_PROPERTIES.expiresAt]),
          updatedAt: dateStart(page.properties[PUSH_PROPERTIES.updatedAt]),
        });
      }
      return { rows: truncated ? [] : rows, truncated };
    },
  };
}
