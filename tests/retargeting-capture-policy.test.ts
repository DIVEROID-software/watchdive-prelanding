import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldOpenCapture,
  scrollProgress,
  type CaptureFacts,
  hasCaptureInterruption,
  videoBlocksCapture,
} from "../src/components/retargeting/policy.ts";
const clear: CaptureFacts = {
  knownSignup: false,
  paid: false,
  seen: false,
  dismissed: false,
  activeForm: false,
  dialog: false,
  playingVideo: false,
  fullscreen: false,
  hidden: false,
};
test("desktop exit only triggers at viewport top with fine pointer", () => {
  assert.equal(
    shouldOpenCapture(clear, {
      kind: "desktop-exit",
      finePointer: true,
      clientY: 0,
      relatedTarget: false,
    }),
    true,
  );
  for (const patch of [{ clientY: 1 }, { finePointer: false }, { relatedTarget: true }])
    assert.equal(
      shouldOpenCapture(clear, {
        kind: "desktop-exit",
        finePointer: true,
        clientY: 0,
        relatedTarget: false,
        ...patch,
      }),
      false,
    );
});
test("mobile requires half of scrollable page and suppresses desktop scroll", () => {
  assert.equal(scrollProgress(500, 1500, 500), 0.5);
  assert.equal(scrollProgress(0, 500, 500), 0);
  for (const progress of [0, 0.49])
    assert.equal(
      shouldOpenCapture(clear, { kind: "mobile-scroll", finePointer: false, progress }),
      false,
    );
  assert.equal(
    shouldOpenCapture(clear, { kind: "mobile-scroll", finePointer: false, progress: 0.5 }),
    true,
  );
  assert.equal(
    shouldOpenCapture(clear, { kind: "mobile-scroll", finePointer: true, progress: 1 }),
    false,
  );
});
test("every suppression condition blocks both triggers including pending signup, paid and decline", () => {
  for (const key of Object.keys(clear))
    for (const trigger of [
      { kind: "mobile-scroll", finePointer: false, progress: 1 },
      { kind: "desktop-exit", finePointer: true, clientY: 0, relatedTarget: false },
    ] as const)
      assert.equal(shouldOpenCapture({ ...clear, [key]: true }, trigger), false, key);
});
test("actual interruption adapter detects active form, dialogs, video and fullscreen", () => {
  const doc = {
    fullscreenElement: null,
    hidden: false,
    activeElement: { closest: () => null },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  assert.equal(hasCaptureInterruption(doc as unknown as Document), false);
  for (const patch of [
    { fullscreenElement: {} },
    { hidden: true },
    { activeElement: { closest: () => ({}) } },
    { querySelector: () => ({}) },
    {
      querySelectorAll: () => [
        {
          paused: false,
          ended: false,
          muted: false,
          volume: 1,
          controls: true,
          getBoundingClientRect: () => ({
            width: 100,
            height: 100,
            bottom: 100,
            right: 100,
            top: 0,
            left: 0,
          }),
          hasAttribute: () => false,
        },
      ],
    },
  ])
    assert.equal(hasCaptureInterruption({ ...doc, ...patch } as unknown as Document), true);
  assert.equal(
    hasCaptureInterruption({
      ...doc,
      querySelectorAll: () => [{ paused: true, ended: false }],
    } as unknown as Document),
    false,
  );
});
test("device suppression reuses existing signup handles, stores no identity, and paid cannot downgrade", async () => {
  const { markDeviceSignupStatus, readDeviceSignupStatus, DEVICE_SIGNUP_KEY } =
    await import("../src/components/retargeting/device-status.ts");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const now = 1_800_000_000_000;
  assert.deepEqual(readDeviceSignupStatus(storage, now), { signedUp: false, paid: false });
  values.set(
    "watchdive.signup-handles.v1",
    JSON.stringify([`mock-lead.${now}.consent.signed-handle`]),
  );
  assert.equal(readDeviceSignupStatus(storage, now).signedUp, true);
  values.clear();
  markDeviceSignupStatus("pending", storage, now);
  assert.deepEqual(readDeviceSignupStatus(storage, now), { signedUp: true, paid: false });
  markDeviceSignupStatus("paid", storage, now);
  markDeviceSignupStatus("pending", storage, now);
  assert.deepEqual(readDeviceSignupStatus(storage, now), { signedUp: true, paid: true });
  assert.deepEqual(Object.keys(JSON.parse(values.get(DEVICE_SIGNUP_KEY)!)).sort(), [
    "at",
    "status",
  ]);
});

test("ambient looping heroes do not block capture forever; visible watched video and audio do", () => {
  const ambient = {
    paused: false,
    ended: false,
    muted: true,
    volume: 1,
    controls: false,
    userPlaying: false,
    visible: false,
  };
  assert.equal(videoBlocksCapture(ambient), false);
  assert.equal(videoBlocksCapture({ ...ambient, visible: true }), false);
  assert.equal(videoBlocksCapture({ ...ambient, visible: true, controls: true }), true);
  assert.equal(videoBlocksCapture({ ...ambient, visible: true, userPlaying: true }), true);
  assert.equal(videoBlocksCapture({ ...ambient, muted: false }), true);
  assert.equal(
    videoBlocksCapture({ ...ambient, paused: true, controls: true, visible: true }),
    false,
  );
  const doc = {
    defaultView: { innerWidth: 390, innerHeight: 844 },
    hidden: false,
    fullscreenElement: null,
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [
      {
        ...ambient,
        getBoundingClientRect: () => ({
          width: 390,
          height: 250,
          top: -900,
          bottom: -650,
          left: 0,
          right: 390,
        }),
        hasAttribute: () => false,
      },
    ],
  };
  assert.equal(hasCaptureInterruption(doc as unknown as Document), false);
  assert.equal(
    shouldOpenCapture(
      { ...clear, playingVideo: hasCaptureInterruption(doc as unknown as Document) },
      { kind: "mobile-scroll", finePointer: false, progress: 0.5 },
    ),
    true,
  );
});
