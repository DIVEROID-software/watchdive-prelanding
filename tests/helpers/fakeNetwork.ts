// In-memory doubles for the two HTTP APIs the waitlist talks to, at the wire.
//
// The store-level fakes in fakes.ts replace a whole module; these replace only
// `fetch`, so every production query builder, property parser, PATCH body and
// Resend payload runs for real. The Notion double is deliberately strict where
// the real API is strict — an unknown property, a value whose shape does not
// match the column type, or a filter condition on the wrong type is a 400
// `validation_error` — so an integration bug fails here the way it would
// against the live database instead of being absorbed by a lenient fake.
//
// Only the subset of the API the code sends is implemented; anything else
// throws so a new request shape is noticed rather than silently answered.

export type ColumnType =
  "title" | "rich_text" | "email" | "select" | "multi_select" | "checkbox" | "number" | "date";

/** The live waitlist columns the verification, reminder and referral code read or write. */
export const LIVE_WAITLIST_SCHEMA: Record<string, ColumnType> = {
  Email: "title",
  "Canonical email": "email",
  Phone: "rich_text",
  "SMS consent": "rich_text",
  Source: "select",
  "Signed up": "date",
  "Ref code": "rich_text",
  "Referred by": "rich_text",
  Flags: "multi_select",
  Suspect: "checkbox",
  Duplicate: "checkbox",
  "UTM Source": "rich_text",
  "UTM Medium": "rich_text",
  "UTM Campaign": "rich_text",
  "UTM Content": "rich_text",
  "UTM Term": "rich_text",
  "Landing path": "rich_text",
  "Signup country": "rich_text",
  "Signup country source": "rich_text",
  "Signup country observed": "date",
  "Signup method": "select",
  "Google subject": "rich_text",
  "Apple subject": "rich_text",
  "Auth verification provenance": "rich_text",
  "Signup locale": "rich_text",
  "Verification status": "select",
  "Verification sent": "date",
  "Verification expires": "date",
  "Email verified": "checkbox",
  "Verified at": "date",
  "Verification sends": "number",
  "Lead ID": "rich_text",
  "Meta Event ID": "rich_text",
  "Welcome email": "date",
  "Verification reminder": "rich_text",
  "Measurement consent": "rich_text",
  "Conversion experiment": "rich_text",
  "Press event": "rich_text",
  "Press sync": "rich_text",
};

export type NotionCall = { method: string; path: string; body: unknown };

type Page = {
  id: string;
  created_time: string;
  /** Stored as Notion returns them (with plain_text), one entry per set column. */
  properties: Record<string, unknown>;
};

class NotionHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message: string): never {
  throw new NotionHttpError(400, "validation_error", message);
}

function unsupported(what: string): never {
  // Not a Notion answer: the code sent something this double does not model.
  throw new Error(`fake Notion does not implement ${what}`);
}

function richOut(
  parts: unknown,
  name: string,
): { type: "text"; text: { content: string }; plain_text: string }[] {
  if (!Array.isArray(parts)) invalid(`${name} is expected to be rich_text.`);
  return parts.map((part) => {
    const content = (part as { text?: { content?: unknown } })?.text?.content;
    if (typeof content !== "string") invalid(`${name} rich text content is invalid.`);
    if (content.length > 2000) invalid(`${name} text content length should be ≤ 2000.`);
    return { type: "text" as const, text: { content }, plain_text: content };
  });
}

function emptyValue(type: ColumnType): unknown {
  switch (type) {
    case "title":
      return { type, title: [] };
    case "rich_text":
      return { type, rich_text: [] };
    case "multi_select":
      return { type, multi_select: [] };
    case "checkbox":
      return { type, checkbox: false };
    default:
      return { type, [type]: null };
  }
}

export class FakeNotion {
  readonly databaseId: string;
  readonly schema: Record<string, ColumnType>;
  readonly selectOptions = new Map<string, string[]>();
  readonly pages = new Map<string, Page>();
  readonly calls: NotionCall[] = [];
  private seq = 0;
  private createdBase = Date.parse("2026-07-01T00:00:00.000Z");

  constructor(databaseId: string, schema: Record<string, ColumnType> = LIVE_WAITLIST_SCHEMA) {
    this.databaseId = databaseId;
    this.schema = { ...schema };
  }

  /** The `fetch` shape `createNotionRequest` calls. */
  async handle(url: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.replace(/^https:\/\/api\.notion\.com\/v1\//, "");
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    this.calls.push({ method, path, body });
    const headers = new Headers(init.headers);
    if (!/^Bearer \S+/.test(headers.get("Authorization") ?? "")) {
      return Response.json(
        { object: "error", code: "unauthorized", message: "API token is invalid." },
        { status: 401 },
      );
    }
    try {
      return Response.json(this.route(method, decodeURIComponent(path), body));
    } catch (error) {
      if (error instanceof NotionHttpError) {
        return Response.json(
          { object: "error", status: error.status, code: error.code, message: error.message },
          { status: error.status },
        );
      }
      throw error;
    }
  }

  private route(method: string, path: string, body: unknown): unknown {
    const db = this.databaseId;
    if (method === "POST" && path === `databases/${db}/query`) return this.query(body);
    if (method === "GET" && path === `databases/${db}`) return this.databaseObject();
    if (method === "PATCH" && path === `databases/${db}`) return this.updateDatabase(body);
    if (method === "POST" && path === "pages") return this.createPage(body);
    const page = /^pages\/([^/]+)$/.exec(path);
    if (page && method === "GET") return this.render(this.page(page[1]));
    if (page && method === "PATCH") return this.patchPage(page[1], body);
    if (/^databases\/[^/]+/.test(path)) {
      throw new NotionHttpError(404, "object_not_found", "Could not find database.");
    }
    return unsupported(`${method} ${path}`);
  }

  // ---- schema ------------------------------------------------------------

  private databaseObject() {
    return {
      object: "database",
      id: this.databaseId,
      properties: Object.fromEntries(
        Object.entries(this.schema).map(([name, type]) => [
          name,
          {
            id: name,
            name,
            type,
            ...(type === "select"
              ? {
                  select: {
                    options: (this.selectOptions.get(name) ?? []).map((option) => ({
                      id: `${name}:${option}`,
                      name: option,
                    })),
                  },
                }
              : { [type]: {} }),
          },
        ]),
      ),
    };
  }

  private updateDatabase(body: unknown) {
    const properties = (body as { properties?: Record<string, Record<string, unknown>> })
      ?.properties;
    if (!properties) invalid("body.properties should be defined.");
    for (const [name, spec] of Object.entries(properties)) {
      const keys = Object.keys(spec);
      if (keys.length !== 1) unsupported(`database property spec ${JSON.stringify(spec)}`);
      const type = keys[0] as ColumnType;
      const existing = this.schema[name];
      if (existing && existing !== type) unsupported("retyping a column");
      this.schema[name] = type;
      if (type === "select") {
        const options = (
          (spec.select as { options?: { id?: string; name?: string }[] })?.options ?? []
        ).map((option) => option.name ?? String(option.id).split(":").slice(1).join(":"));
        this.selectOptions.set(name, [
          ...new Set([...(this.selectOptions.get(name) ?? []), ...options]),
        ]);
      }
    }
    return this.databaseObject();
  }

  // ---- pages -------------------------------------------------------------

  private page(id: string): Page {
    const page = this.pages.get(id);
    if (!page) throw new NotionHttpError(404, "object_not_found", "Could not find page.");
    return page;
  }

  private normalizeValue(name: string, value: unknown): unknown {
    const type = this.schema[name];
    if (!type) invalid(`${name} is not a property that exists.`);
    const v = value as Record<string, unknown>;
    if (!v || typeof v !== "object" || !(type in v)) invalid(`${name} is expected to be ${type}.`);
    const raw = v[type];
    switch (type) {
      case "title":
      case "rich_text":
        return { type, [type]: richOut(raw, name) };
      case "email":
        if (raw !== null && typeof raw !== "string") invalid(`${name} is expected to be email.`);
        if (typeof raw === "string" && raw.length > 200)
          invalid(`${name} email length should be ≤ 200.`);
        return { type, email: raw || null };
      case "checkbox":
        if (typeof raw !== "boolean") invalid(`${name} is expected to be checkbox.`);
        return { type, checkbox: raw };
      case "number":
        if (raw !== null && typeof raw !== "number") invalid(`${name} is expected to be number.`);
        return { type, number: raw };
      case "date": {
        if (raw === null) return { type, date: null };
        const start = (raw as { start?: unknown })?.start;
        if (typeof start !== "string" || !Number.isFinite(Date.parse(start))) {
          invalid(`${name} date start is invalid.`);
        }
        return { type, date: { start, end: null, time_zone: null } };
      }
      case "select": {
        if (raw === null) return { type, select: null };
        const optionName = (raw as { name?: unknown })?.name;
        if (typeof optionName !== "string" || !optionName)
          invalid(`${name} select name is invalid.`);
        // Notion creates a missing select option on write.
        this.selectOptions.set(name, [
          ...new Set([...(this.selectOptions.get(name) ?? []), optionName]),
        ]);
        return { type, select: { id: `${name}:${optionName}`, name: optionName } };
      }
      case "multi_select": {
        if (!Array.isArray(raw)) invalid(`${name} is expected to be multi_select.`);
        return {
          type,
          multi_select: raw.map((option) => {
            const optionName = (option as { name?: unknown })?.name;
            if (typeof optionName !== "string") invalid(`${name} option is invalid.`);
            return { id: `${name}:${optionName}`, name: optionName };
          }),
        };
      }
    }
  }

  private writeProperties(page: Page, properties: unknown) {
    if (!properties || typeof properties !== "object")
      invalid("body.properties should be an object.");
    // Validate everything before applying anything: Notion writes all or nothing.
    const next = Object.entries(properties as Record<string, unknown>).map(
      ([name, value]) => [name, this.normalizeValue(name, value)] as const,
    );
    for (const [name, value] of next) page.properties[name] = value;
  }

  private createPage(body: unknown) {
    const b = body as { parent?: { database_id?: string }; properties?: unknown };
    if (b?.parent?.database_id !== this.databaseId) {
      throw new NotionHttpError(404, "object_not_found", "Could not find database.");
    }
    this.seq += 1;
    const page: Page = {
      id: `00000000-0000-4000-8000-${this.seq.toString(16).padStart(12, "0")}`,
      created_time: new Date(this.createdBase + this.seq * 60_000).toISOString(),
      properties: {},
    };
    this.writeProperties(page, b.properties);
    const title = Object.entries(this.schema).find(([, type]) => type === "title")?.[0];
    if (!title || !page.properties[title]) invalid("A title property is required.");
    this.pages.set(page.id, page);
    return this.render(page);
  }

  private patchPage(id: string, body: unknown) {
    const page = this.page(id);
    const copy: Page = { ...page, properties: { ...page.properties } };
    this.writeProperties(copy, (body as { properties?: unknown })?.properties);
    this.pages.set(id, copy);
    return this.render(copy);
  }

  /** Ops editing a cell by hand in the Notion UI. */
  setCell(pageId: string, name: string, value: unknown): void {
    this.patchPage(pageId, { properties: { [name]: value } });
  }

  private render(page: Page) {
    return {
      object: "page",
      id: page.id,
      created_time: page.created_time,
      archived: false,
      properties: Object.fromEntries(
        Object.entries(this.schema).map(([name, type]) => [
          name,
          page.properties[name] ?? emptyValue(type),
        ]),
      ),
    };
  }

  // ---- query -------------------------------------------------------------

  private cellText(page: Page, name: string): string {
    const cell = page.properties[name] as Record<string, unknown> | undefined;
    const type = this.schema[name];
    if (!cell) return "";
    if (type === "title" || type === "rich_text") {
      return (cell[type] as { plain_text: string }[]).map((part) => part.plain_text).join("");
    }
    if (type === "email") return (cell.email as string | null) ?? "";
    return "";
  }

  private matches(page: Page, filter: unknown): boolean {
    const f = filter as Record<string, unknown>;
    if (Array.isArray(f.and)) return f.and.every((child) => this.matches(page, child));
    if (Array.isArray(f.or)) return f.or.some((child) => this.matches(page, child));
    if (typeof f.timestamp === "string") unsupported("timestamp filters");
    const name = f.property;
    if (typeof name !== "string") unsupported(`filter ${JSON.stringify(f)}`);
    const type = this.schema[name];
    if (!type) invalid(`Could not find property with name or id: ${name}`);
    const keys = Object.keys(f).filter((key) => key !== "property");
    if (keys.length !== 1) unsupported(`filter ${JSON.stringify(f)}`);
    const key = keys[0];
    // Notion accepts the rich_text condition on a title column; nothing else crosses types.
    if (key !== type && !(key === "rich_text" && type === "title")) {
      invalid(`database property ${type} does not match filter ${key}`);
    }
    const condition = f[key] as Record<string, unknown>;
    const [op, operand] = Object.entries(condition)[0] ?? [];
    const cell = page.properties[name] as Record<string, unknown> | undefined;

    if (type === "title" || type === "rich_text" || type === "email") {
      const text = this.cellText(page, name);
      if (op === "equals") return text === operand;
      if (op === "is_empty") return text === "";
      if (op === "is_not_empty") return text !== "";
      if (op === "contains") return text.includes(String(operand));
    }
    if (type === "checkbox" && op === "equals") return Boolean(cell?.checkbox) === operand;
    if (type === "select") {
      const value = (cell?.select as { name?: string } | null | undefined)?.name ?? null;
      if (op === "equals") return value === operand;
      if (op === "is_empty") return value === null;
      if (op === "is_not_empty") return value !== null;
    }
    if (type === "date") {
      const start = (cell?.date as { start?: string } | null | undefined)?.start;
      if (op === "is_empty") return !start;
      if (op === "is_not_empty") return Boolean(start);
      if (!start) return false;
      const at = Date.parse(start);
      const bound = Date.parse(String(operand));
      if (op === "on_or_before") return at <= bound;
      if (op === "on_or_after") return at >= bound;
      if (op === "before") return at < bound;
      if (op === "after") return at > bound;
    }
    if (type === "number") {
      const value = (cell?.number as number | null | undefined) ?? null;
      if (op === "equals") return value === operand;
      if (op === "is_empty") return value === null;
    }
    return unsupported(`${type} condition ${String(op)}`);
  }

  private sortKey(page: Page, sort: Record<string, unknown>): string | number {
    if (sort.timestamp === "created_time") return Date.parse(page.created_time);
    if (sort.timestamp === "last_edited_time") unsupported("last_edited_time sort");
    const name = sort.property;
    if (typeof name !== "string" || !this.schema[name]) {
      invalid(`Could not find sort property with name or id: ${String(name)}`);
    }
    const cell = page.properties[name] as Record<string, unknown> | undefined;
    if (this.schema[name] === "date") {
      const start = (cell?.date as { start?: string } | null | undefined)?.start;
      // Notion sorts empty values last in either direction; Infinity models ascending.
      return start ? Date.parse(start) : Number.POSITIVE_INFINITY;
    }
    return this.cellText(page, name);
  }

  private query(body: unknown) {
    const b = (body ?? {}) as {
      filter?: unknown;
      sorts?: Record<string, unknown>[];
      page_size?: number;
      start_cursor?: string;
    };
    const size = b.page_size ?? 100;
    if (!Number.isInteger(size) || size < 1 || size > 100) invalid("page_size should be ≤ 100.");
    let rows = [...this.pages.values()];
    if (b.filter !== undefined) rows = rows.filter((page) => this.matches(page, b.filter));
    const sorts = b.sorts ?? [{ timestamp: "created_time", direction: "descending" }];
    rows.sort((x, y) => {
      for (const sort of sorts) {
        const a = this.sortKey(x, sort);
        const c = this.sortKey(y, sort);
        const order = a < c ? -1 : a > c ? 1 : 0;
        if (order !== 0) return sort.direction === "descending" ? -order : order;
      }
      return 0;
    });
    const offset = b.start_cursor
      ? Number(/^cursor-(\d+)$/.exec(b.start_cursor)?.[1] ?? Number.NaN)
      : 0;
    if (!Number.isInteger(offset)) invalid("start_cursor is invalid.");
    const slice = rows.slice(offset, offset + size);
    const more = offset + size < rows.length;
    return {
      object: "list",
      results: slice.map((page) => this.render(page)),
      has_more: more,
      next_cursor: more ? `cursor-${offset + size}` : null,
    };
  }

  // ---- test helpers --------------------------------------------------------

  /** The page whose title (Email) is exactly this address. */
  pageByEmail(email: string): Page | undefined {
    return [...this.pages.values()].find((page) => this.cellText(page, "Email") === email);
  }

  text(pageId: string, name: string): string {
    return this.cellText(this.page(pageId), name);
  }
}

export type ResendMessage = {
  idempotencyKey: string;
  headers: Record<string, string>;
  // Parsed request JSON; tests read nested fields freely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
  raw: string;
};

/**
 * Resend's POST /emails with its idempotency semantics: the same key with a
 * byte-identical body returns the first message (no second mail); the same
 * key with a different body is a 409.
 */
export class FakeResend {
  readonly messages: ResendMessage[] = [];
  /** Requests answered from an earlier message under the same key. */
  collapsed = 0;
  private byKey = new Map<string, { raw: string; id: string }>();

  async handle(_url: string, init: RequestInit = {}): Promise<Response> {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    if (!/^Bearer \S+/.test(headers.authorization ?? "")) {
      return Response.json({ name: "missing_api_key" }, { status: 401 });
    }
    const raw = String(init.body);
    const key = headers["idempotency-key"] ?? "";
    const earlier = key ? this.byKey.get(key) : undefined;
    if (earlier) {
      if (earlier.raw !== raw) {
        return Response.json({ name: "invalid_idempotent_request" }, { status: 409 });
      }
      this.collapsed += 1;
      return Response.json({ id: earlier.id });
    }
    const id = `msg_${this.messages.length + 1}`;
    if (key) this.byKey.set(key, { raw, id });
    this.messages.push({ idempotencyKey: key, headers, body: JSON.parse(raw), raw });
    return Response.json({ id });
  }

  to(address: string): ResendMessage[] {
    return this.messages.filter((message) => (message.body.to as string[]).includes(address));
  }
}

/**
 * One `fetch` for the whole process: Notion and Resend go to the doubles,
 * anything else (Meta, Slack, a stray URL) is recorded and refused.
 */
export function createFakeNetwork(databaseId: string) {
  const notion = new FakeNotion(databaseId);
  const resend = new FakeResend();
  const unexpected: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.notion.com/v1/")) return notion.handle(url, init);
    if (url === "https://api.resend.com/emails") return resend.handle(url, init);
    unexpected.push(url.split("?")[0]);
    throw new TypeError("fetch failed (no network in tests)");
  }) as typeof fetch;
  return { notion, resend, unexpected, fetch: fetchImpl };
}
