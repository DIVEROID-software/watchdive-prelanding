// Server-only binding to Vercel's `waitUntil`.
//
// https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil
// `@vercel/functions` 3.6.1 implements `waitUntil` as
// `getContext().waitUntil?.(promise)`. `getContext` reads
// `globalThis[Symbol.for("@vercel/request-context")]` and returns `{}`
// when that slot is empty, so the public call returns undefined and does
// not hold the promise. This module reads the same slot. It calls the
// public `waitUntil` only when a function is actually there. Otherwise it
// throws, and the signup path awaits the same send.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { waitUntil } from "@vercel/functions";

import type { AfterResponseHook } from "./asyncVerificationMail.ts";

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

type ContextCarrier = {
  get?: () => { waitUntil?: (promise: Promise<unknown>) => void };
};

function activeWaitUntil(): ((promise: Promise<unknown>) => void) | undefined {
  const carrier = (globalThis as typeof globalThis & Record<symbol, ContextCarrier | undefined>)[REQUEST_CONTEXT];
  const hold = carrier?.get?.()?.waitUntil;
  return typeof hold === "function" ? hold : undefined;
}

/**
 * Hook for `createServiceDependencies`. Registers the send on the current
 * Vercel request. Outside that runtime the hook throws
 * `verification_after_response_unavailable` before `waitUntil` can drop the
 * promise.
 */
export function createVercelAfterResponse(): AfterResponseHook {
  return (task) => {
    if (!activeWaitUntil()) {
      throw new Error("verification_after_response_unavailable");
    }
    waitUntil(task);
  };
}
