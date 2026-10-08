import { withdrawAttemptMeasurement } from "@/lib/api/waitlist.functions";
import { markWithdrawalRecorded } from "@/components/measurement-ask";
import { storedSignupHandles } from "@/lib/signupHandles";

/**
 * Records a refusal against every signup this browser still holds a handle
 * for. True only when every one of them came back recorded (a handle with no
 * row answers recorded as well). Retried, because a dropped call is not a
 * recorded refusal.
 */
export async function withdrawStoredSignups(
  handles: readonly string[] = storedSignupHandles(),
): Promise<boolean> {
  let all = true;
  for (const handle of handles) {
    let recorded = false;
    for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
      try {
        recorded = (await withdrawAttemptMeasurement({ data: { handle } })).recorded;
      } catch {
        recorded = false;
      }
      if (!recorded && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    all &&= recorded;
  }
  return all;
}

/**
 * A refusal in this browser, recorded on every signup it kept a handle for
 * (plus any handle still only in memory). The browser-wide receipt is set only
 * when every one of them was recorded, so a reload retries whatever was not.
 */
export async function withdrawEverySignup(extra: readonly string[] = []): Promise<boolean> {
  const handles = [...new Set([...extra.filter(Boolean), ...storedSignupHandles()])];
  const all = await withdrawStoredSignups(handles);
  // Nothing to withdraw is not a receipt: only a refusal that reached at
  // least one signup row marks this browser as recorded.
  if (all && handles.length > 0) markWithdrawalRecorded();
  return all;
}
