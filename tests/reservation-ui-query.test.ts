import test from "node:test";
import assert from "node:assert/strict";

test("reservation entry keeps signup language and Stripe return language before country fallback", async () => {
  const { reservationInitialLocaleRedirect } =
    await import("../src/components/reservation/query.ts");
  assert.equal(
    reservationInitialLocaleRedirect(new Request("https://example.com/reservation?lang=ja"), "KR"),
    null,
  );
  assert.equal(
    reservationInitialLocaleRedirect(
      new Request("https://example.com/reservation?session_id=cs_test_x"),
      "KR",
    ),
    null,
  );
  assert.equal(
    reservationInitialLocaleRedirect(
      new Request("https://example.com/reservation?canceled=1"),
      "KR",
    ),
    null,
  );
  assert.equal(
    reservationInitialLocaleRedirect(new Request("https://example.com/reservation"), "KR"),
    "/reservation?lang=ko",
  );
  assert.equal(
    reservationInitialLocaleRedirect(
      new Request("https://example.com/reservation", {
        headers: { cookie: "watchdive.locale=fr" },
      }),
      "KR",
    ),
    "/reservation?lang=fr",
  );
});
