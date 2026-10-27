// Reads the social receipt cookie and fires the events the server put there.
// A denied browser keeps the cookie so a later Allow can retry the same ids.

import { MEASUREMENT_CHOICE_EVENT } from "../measurementChoice.ts";
import { trackRetargetingBrowser, type BrowserSinks } from "./browser.ts";
import type { BrowserRetargetingEvent } from "./events.ts";
import {
  readRetargetingReceipt,
  retargetingReceiptClearCookie,
  RETARGETING_RECEIPT_COOKIE,
} from "./receipt.ts";

const fired = new Set<string>();
let listening = false;

export function resetSocialReceiptForTests(): void {
  fired.clear();
  listening = false;
}

export function fireRetargetingReceipt(
  cookieHeader: string,
  sinks?: BrowserSinks,
): { fired: BrowserRetargetingEvent[]; waiting: boolean } {
  const events = readRetargetingReceipt(cookieHeader) ?? [];
  const sent: BrowserRetargetingEvent[] = [];
  let waiting = false;
  for (const event of events) {
    if (fired.has(event.eventId)) continue;
    const result = trackRetargetingBrowser(event, sinks);
    if (result.reason === "consent") waiting = true;
    else {
      fired.add(event.eventId);
      sent.push(event);
    }
  }
  return { fired: sent, waiting };
}

export function consumeSocialRetargetingReceipt(): void {
  if (typeof document === "undefined") return;
  const result = fireRetargetingReceipt(document.cookie);
  if (!result.waiting && readRetargetingReceipt(document.cookie)) {
    document.cookie = retargetingReceiptClearCookie();
  }
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener(MEASUREMENT_CHOICE_EVENT, () => {
    if (typeof document === "undefined" || !document.cookie.includes(`${RETARGETING_RECEIPT_COOKIE}=`)) return;
    consumeSocialRetargetingReceipt();
  });
}
