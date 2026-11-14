// Bounded recovery for a transient Notion read. Writes stay single-attempt.
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNotionOperation,
  createNotionLeadStore,
  createNotionRequest,
  NotionRequestError,
  notionReadBackoffMs,
  notionRetryDelay,
  type NotionAttemptEvent,
  type NotionRequestControl,
} from "../src/lib/verification/notionLead.ts";

const DB = "11111111-2222-4333-8444-555555555555";
const EMAIL = "owner@example.com";
const TOKEN = "secret_notion_token_should_not_leak";
const PAGE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENV = { NOTION_API_KEY: TOKEN };

type Call = {
  url: string;
  method: string;
  body: string | undefined;
  signal: AbortSignal;
  abortedAtStart: boolean;
};

function leakBody(status: number) {
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            code: status >= 500 ? "internal_server_error" : "validation_error",
            message: `Could not find page ${PAGE} for ${EMAIL} token ${TOKEN} database ${DB}`,
          }),
        ),
      );
      controller.close();
    },
  });
  const response = new Response(stream, { status });
  return { response, pulled: () => pulled };
}

function queryResult() {
  return {
    object: "list",
    results: [
      {
        object: "page",
        id: PAGE,
        properties: { Email: { title: [{ plain_text: EMAIL }] } },
      },
    ],
    has_more: false,
  };
}

function hang(signal: AbortSignal): Promise<never> {
  // AbortSignal.timeout does not keep the event loop alive. A ref'd timer lets
  // that unref'd deadline fire, then this wait ends with it.
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("hang outlived the abort")), 5_000);
    const finish = (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    };
    if (signal.aborted) {
      finish(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => finish(signal.reason), { once: true });
  });
}

function harness(
  handler: (call: Call, index: number) => Promise<Response> | Response,
  control: Partial<NotionRequestControl> = {},
) {
  const calls: Call[] = [];
  const events: NotionAttemptEvent[] = [];
  const sleeps: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing signal");
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      signal,
      abortedAtStart: signal.aborted,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  const request = createNotionRequest(fetchImpl, ENV, "2022-06-28", {
    timeoutMs: 30,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (event) => events.push(event),
    ...control,
  });
  return { request, calls, events, sleeps };
}

function assertRedacted(value: string) {
  assert.equal(value.includes(DB), false, "database id leaked");
  assert.equal(value.includes(EMAIL), false, "address leaked");
  assert.equal(value.includes(TOKEN), false, "token leaked");
  assert.equal(value.includes(PAGE), false, "page id leaked");
  assert.equal(value.includes("Could not find page"), false, "raw API message leaked");
}

test("backoff stays inside a short jitter window", () => {
  assert.equal(notionReadBackoffMs(0), 250);
  assert.equal(notionReadBackoffMs(0.999), 299);
  assert.equal(notionReadBackoffMs(Number.NaN), 250);
  assert.deepEqual(notionRetryDelay(null, 0, 0), { waitMs: 250 });
  assert.deepEqual(notionRetryDelay("0", 0, 0), { waitMs: 0 });
  assert.deepEqual(notionRetryDelay("1", 0, 0), { waitMs: 1000 });
  assert.deepEqual(notionRetryDelay("2", 0, 0), { waitMs: 2000 });
  assert.deepEqual(notionRetryDelay("3", 0, 0), { stop: true });
  assert.deepEqual(notionRetryDelay("30", 0, 0), { stop: true });
  assert.deepEqual(notionRetryDelay("not-a-date", 0, 0), { stop: true });
  assert.deepEqual(notionRetryDelay(new Date(5_000).toUTCString(), 4_000, 0), { waitMs: 1000 });
  assert.deepEqual(notionRetryDelay(new Date(60_000).toUTCString(), 0, 0), { stop: true });
  assert.equal(classifyNotionOperation("GET", `pages/${PAGE}`), "read_get");
  assert.equal(classifyNotionOperation("POST", `databases/${DB}/query`), "read_query");
  assert.equal(classifyNotionOperation("POST", "pages"), "write_create");
  assert.equal(classifyNotionOperation("PATCH", `pages/${PAGE}`), "write_update");
  assert.equal(classifyNotionOperation("POST", "search"), "write_other");
  assert.equal(classifyNotionOperation("POST", `databases/${DB}/query/`), "write_other");
});

test("a timed-out query succeeds on the next read and keeps the same body", async () => {
  const { request, calls, events, sleeps } = harness(async (call, index) => {
    if (index === 0) await hang(call.signal);
    return Response.json(queryResult());
  });
  const body = { filter: { property: "Lead ID", rich_text: { equals: "lead-1" } }, page_size: 1 };
  const result = await request("POST", `databases/${DB}/query`, body);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal === calls[1].signal, false);
  assert.equal(calls[0].abortedAtStart, false);
  assert.equal(calls[1].abortedAtStart, false);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 250);
  assert.equal((result.results as unknown[]).length, 1);
  assert.deepEqual(
    events.map((event) => [event.operation, event.reason, event.outcome, event.status]),
    [["read_query", "timeout", "retry", 0]],
  );
  assertRedacted(JSON.stringify(events));
});

test("findByLeadId recovers from one query timeout and does not write", async () => {
  const { request, calls } = harness(async (call, index) => {
    if (index === 0) await hang(call.signal);
    return Response.json(queryResult());
  });
  const row = await createNotionLeadStore(request, DB).findByLeadId("lead-1");
  assert.equal(row?.email, EMAIL);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST", "POST"],
  );
  assert.equal(calls.every((call) => call.url.endsWith(`/databases/${DB}/query`)), true);
});

test("a rate limit and a server error on a read are retried once", async () => {
  for (const status of [429, 500, 503, 599]) {
    const bodies: Array<{ pulled: () => number }> = [];
    const { request, calls, sleeps, events } = harness((_call, index) => {
      if (index === 0) {
        const made = leakBody(status);
        bodies.push(made);
        return made.response;
      }
      return Response.json({ object: "page", id: PAGE });
    });
    const result = await request("GET", `pages/${PAGE}`);
    assert.equal(result.id, PAGE);
    assert.equal(calls.length, 2, `status ${status} fetched ${calls.length} times`);
    assert.equal(sleeps.length, 1);
    assert.equal(bodies[0].pulled(), 1, `status ${status} left the error body unread`);
    assert.equal(events[0].reason, status === 429 ? "rate_limit" : "server");
    assert.equal(events[0].operation, "read_get");
    assertRedacted(JSON.stringify(events));
  }
});

test("a permanent 4xx is not retried and its body is not echoed", async () => {
  for (const status of [400, 401, 404, 409, 408]) {
    const made = leakBody(status);
    const { request, calls, sleeps } = harness(() => made.response);
    await assert.rejects(request("POST", `databases/${DB}/query`, { page_size: 1 }), (error: unknown) => {
      assert.ok(error instanceof NotionRequestError);
      assert.equal(error.status, status);
      assertRedacted(error.message);
      assert.equal(error.detail.includes(EMAIL), false);
      assert.equal(error.detail.includes(TOKEN), false);
      assert.equal(error.detail.includes(PAGE), false);
      assert.equal(error.detail.includes(DB), false);
      assertRedacted(String(error.stack));
      return true;
    });
    assert.equal(calls.length, 1, `status ${status}`);
    assert.equal(sleeps.length, 0, `status ${status} slept`);
    assert.equal(made.pulled(), 1);
  }
});

test("page creates, updates, and other posts are never retried", async () => {
  const cases: Array<{ method: "POST" | "PATCH"; path: string; operation: string }> = [
    { method: "POST", path: "pages", operation: "write_create" },
    { method: "PATCH", path: `pages/${PAGE}`, operation: "write_update" },
    { method: "POST", path: "search", operation: "write_other" },
    { method: "POST", path: `databases/${DB}/query/`, operation: "write_other" },
  ];
  for (const item of cases) {
    for (const failure of ["timeout", "http"] as const) {
      const { request, calls, sleeps, events } = harness(async (call) => {
        if (failure === "timeout") await hang(call.signal);
        return leakBody(item.method === "PATCH" ? 429 : 503).response;
      });
      await assert.rejects(request(item.method, item.path, { properties: { Email: EMAIL } }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assertRedacted(error.message);
        assertRedacted(String(error.stack));
        if (failure === "timeout") assert.equal(error.name, "TimeoutError");
        return true;
      });
      assert.equal(calls.length, 1, `${item.operation} ${failure}`);
      assert.equal(sleeps.length, 0, `${item.operation} ${failure} slept`);
      assert.equal(events[0].operation, item.operation);
      assert.equal(events[0].outcome, "terminal");
      assertRedacted(JSON.stringify(events));
    }
  }
});

test("markVerified does not repeat a timed-out patch", async () => {
  const { request, calls, events } = harness(async (call) => hang(call.signal));
  await assert.rejects(
    createNotionLeadStore(request, DB).markVerified(PAGE, {
      verifiedAt: "2026-11-02T05:47:32.000Z",
      metaEventId: "evt-1",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.message, "Notion request timed out");
      return true;
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(events[0].operation, "write_update");
  assert.equal(events[0].outcome, "terminal");
});

test("a withdrawal retries its page read and still patches once per write", async () => {
  const { request, calls } = harness(async (call, index) => {
    if (index === 0) await hang(call.signal);
    return Response.json({
      object: "page",
      id: PAGE,
      properties: { Email: { title: [{ plain_text: EMAIL }] }, Flags: { multi_select: [] } },
    });
  });
  await createNotionLeadStore(request, DB).recordMeasurementWithdrawal(PAGE);
  const gets = calls.filter((call) => call.method === "GET");
  const patches = calls.filter((call) => call.method === "PATCH");
  // Flags, consent, and the optional experiment cell. A configured fbc column adds one clear.
  const patchWrites = process.env.NOTION_META_FBC_PROPERTY?.trim() ? 4 : 3;
  assert.equal(gets.length, 2);
  assert.equal(patches.length, patchWrites);
  assert.equal(calls.every((call) => call.method === "GET" || call.method === "PATCH"), true);
  assert.equal(calls.every((call) => new URL(call.url).pathname === `/v1/pages/${PAGE}`), true);
});

test("a read gives up after two timeouts with a redacted TimeoutError", async () => {
  const original = console.error;
  const lines: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    const { request, calls, events } = harness(async (call) => hang(call.signal), {
      log: undefined,
    });
    await assert.rejects(request("POST", `databases/${DB}/query`, { page_size: 1 }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "TimeoutError");
      assert.equal(error.message, "Notion request timed out");
      assert.equal("cause" in error && (error as { cause?: unknown }).cause !== undefined, false);
      assertRedacted(error.message);
      assertRedacted(String(error.stack));
      return true;
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal === calls[1].signal, false);
    assert.equal(events.length, 0);
    assert.equal(lines.length, 2);
    assert.equal(lines[0][0], "[watchdive] notion_request");
    assert.equal((lines[0][1] as NotionAttemptEvent).outcome, "retry");
    assert.equal((lines[1][1] as NotionAttemptEvent).outcome, "terminal");
    assert.equal((lines[1][1] as NotionAttemptEvent).operation, "read_query");
    assertRedacted(JSON.stringify(lines));
  } finally {
    console.error = original;
  }
});

test("repeated rate limits and server errors stop at two redacted failures", async () => {
  for (const status of [429, 502]) {
    const made = [leakBody(status), leakBody(status)];
    let index = 0;
    const { request, calls } = harness(() => made[index++].response);
    await assert.rejects(request("GET", `databases/${DB}`), (error: unknown) => {
      assert.ok(error instanceof NotionRequestError);
      assert.equal(error.status, status);
      assert.match(error.message, new RegExp(`Notion request failed \\(${status}\\)`));
      assertRedacted(error.message);
      assert.equal(error.detail.includes(EMAIL), false);
      assert.equal(error.detail.includes(TOKEN), false);
      assert.equal(error.detail.includes(PAGE), false);
      assert.equal(error.detail.includes(DB), false);
      return true;
    });
    assert.equal(calls.length, 2, `status ${status}`);
    assert.equal(made[0].pulled(), 1);
    assert.equal(made[1].pulled(), 1);
  }
});

test("a network failure is retried once and a leaked URL is not rethrown", async () => {
  const leaked = new TypeError(`fetch failed https://api.notion.com/v1/databases/${DB}/query ${EMAIL}`);
  const { request, calls, events } = harness((_call, index) => {
    if (index === 0) throw leaked;
    return Response.json({ ok: true });
  });
  assert.deepEqual(await request("GET", `pages/${PAGE}`), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(events[0].reason, "network");

  const exhausted = harness(() => {
    throw leaked;
  });
  await assert.rejects(exhausted.request("GET", `pages/${PAGE}`), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "NotionTransportError");
    assert.equal(error.message, "Notion request failed");
    assertRedacted(error.message);
    assertRedacted(String(error.stack));
    return true;
  });
  assert.equal(exhausted.calls.length, 2);
  assertRedacted(JSON.stringify(exhausted.events));
});

test("a caller abort is not retried, including during backoff and an outer deadline", async () => {
  const already = new AbortController();
  already.abort();
  const before = harness(async () => Response.json({ ok: true }), { signal: already.signal });
  await assert.rejects(before.request("GET", `pages/${PAGE}`), (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
  assert.equal(before.calls.length, 0);

  const during = new AbortController();
  const mid = harness(
    async (call) => {
      during.abort();
      throw call.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    },
    { signal: during.signal },
  );
  await assert.rejects(mid.request("POST", `databases/${DB}/query`), (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    assertRedacted((error as Error).message);
    return true;
  });
  assert.equal(mid.calls.length, 1);
  assert.equal(mid.sleeps.length, 0);

  const caller = new AbortController();
  const backoff = harness(() => leakBody(503).response, {
    signal: caller.signal,
    sleep: () =>
      new Promise(() => {
        caller.abort();
      }),
  });
  await assert.rejects(backoff.request("GET", `pages/${PAGE}`), (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
  assert.equal(backoff.calls.length, 1);

  const outer = harness(() => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  await assert.rejects(outer.request("GET", `pages/${PAGE}`), (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
  assert.equal(outer.calls.length, 1);
  assert.equal(outer.events[0].reason, "caller_abort");
});

test("a successful read does not sleep, log, or open a second request", async () => {
  let randomCalls = 0;
  const { request, calls, events, sleeps } = harness(() => Response.json(queryResult()), {
    random: () => {
      randomCalls += 1;
      return 0;
    },
  });
  await request("POST", `databases/${DB}/query`, { page_size: 1 });
  assert.equal(calls.length, 1);
  assert.equal(sleeps.length, 0);
  assert.equal(events.length, 0);
  assert.equal(randomCalls, 0);
  assert.equal(calls[0].abortedAtStart, false);
});

test("an unreadable success is not retried and does not quote the body", async () => {
  const { request, calls } = harness(
    () =>
      new Response(`not-json ${EMAIL} ${PAGE} ${TOKEN}`, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  await assert.rejects(request("GET", `pages/${PAGE}`), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Notion request failed");
    assertRedacted(error.message);
    assertRedacted(String(error.stack));
    return true;
  });
  assert.equal(calls.length, 1);
});

test("a short Retry-After is waited and a long one stops the read", async () => {
  const soon = harness((_call, index) => {
    if (index === 0) {
      return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    }
    return Response.json({ ok: true });
  });
  assert.deepEqual(await soon.request("GET", `pages/${PAGE}`), { ok: true });
  assert.equal(soon.calls.length, 2);
  assert.equal(soon.sleeps[0], 1000);
  assert.equal(soon.events[0].reason, "rate_limit");

  for (const header of ["30", new Date(Date.now() + 60_000).toUTCString()]) {
    const late = harness(
      () => new Response(`{"message":"${EMAIL} ${PAGE}"}`, { status: 429, headers: { "retry-after": header } }),
    );
    await assert.rejects(late.request("POST", `databases/${DB}/query`), (error: unknown) => {
      assert.ok(error instanceof NotionRequestError);
      assert.equal(error.status, 429);
      assertRedacted(error.message);
      return true;
    });
    assert.equal(late.calls.length, 1, header);
    assert.equal(late.sleeps.length, 0, header);
    assert.equal(late.events[0].outcome, "terminal");
  }
});

test("a timed-out success body is retried and a caller abort during an error body is not", async () => {
  const stalled = harness((call, index) => {
    if (index > 0) return Response.json(queryResult());
    let keepAlive: ReturnType<typeof setTimeout> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        keepAlive = setTimeout(() => controller.error(new Error("body hang outlived the abort")), 5_000);
        const fail = () => {
          if (keepAlive) clearTimeout(keepAlive);
          controller.error(call.signal.reason);
        };
        if (call.signal.aborted) fail();
        else call.signal.addEventListener("abort", fail, { once: true });
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await stalled.request("POST", `databases/${DB}/query`, { page_size: 1 });
  assert.equal((result.results as unknown[]).length, 1);
  assert.equal(stalled.calls.length, 2);
  assert.equal(stalled.events[0].reason, "timeout");
  assert.equal(stalled.events[0].operation, "read_query");
  assertRedacted(JSON.stringify(stalled.events));

  const caller = new AbortController();
  const aborted = harness(
    (call) => {
      const stream = new ReadableStream({
        start(controller) {
          caller.abort();
          controller.error(call.signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
        },
      });
      return new Response(stream, {
        status: 429,
        headers: { "retry-after": "0", "content-type": "application/json" },
      });
    },
    { signal: caller.signal },
  );
  await assert.rejects(aborted.request("GET", `pages/${PAGE}`), (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    assertRedacted((error as Error).message);
    return true;
  });
  assert.equal(aborted.calls.length, 1);
  assert.equal(aborted.sleeps.length, 0);
  assert.equal(aborted.events[0].reason, "caller_abort");
});

test("a broken error body still honors Retry-After", async () => {
  for (const header of ["1", "30"]) {
    const check = harness((_call, index) => {
      if (index > 0) return Response.json({ ok: true });
      const stream = new ReadableStream({
        start(controller) { controller.error(new TypeError("connection lost")); },
      });
      return new Response(stream, { status: 429, headers: { "retry-after": header } });
    });
    if (header === "1") {
      assert.deepEqual(await check.request("GET", `pages/${PAGE}`), { ok: true });
      assert.equal(check.calls.length, 2);
      assert.deepEqual(check.sleeps, [1000]);
    } else {
      await assert.rejects(check.request("GET", `pages/${PAGE}`));
      assert.equal(check.calls.length, 1);
      assert.deepEqual(check.sleeps, []);
    }
  }
});


test("signed reconfirmation records its own date without rewriting original verification or attribution", async () => {
  let captured: unknown;
  const store=createNotionLeadStore(async (method,path,body)=>{
    assert.equal(method,"PATCH");assert.equal(path,`pages/${PAGE}`);captured=body;return {};
  },DB);
  await store.noteReconfirmation!(PAGE,"2026-11-14T09:00:00.000Z");
  assert.deepEqual(captured,{properties:{"Last reconfirmed":{date:{start:"2026-11-14T09:00:00.000Z"}}}});
});
