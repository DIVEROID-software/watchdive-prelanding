// Browser request for a personal reservation link. The public URL stays
// /reservation?lang= with no token. This POST is the explicit send request.

export const RESERVATION_RETURN_PATH = "/api/reservation/return";

export type ReturnSubmitResult = "accepted" | "invalid_email" | "unavailable";

export function shouldOfferReturnForm(input: {
  inviteToken: string | null;
  phase: string;
  entryResolved: boolean;
  resumeSettled: boolean;
}): boolean {
  return (
    input.entryResolved &&
    input.resumeSettled &&
    !input.inviteToken &&
    input.phase === "needs_invitation"
  );
}

export async function submitReservationReturn(input: {
  email: string;
  locale: string;
  honeypot: string;
  fetchImpl?: typeof fetch;
}): Promise<ReturnSubmitResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(RESERVATION_RETURN_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        email: input.email,
        locale: input.locale,
        company: input.honeypot,
      }),
    });
  } catch {
    return "unavailable";
  }
  if (response.status === 400) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === "invalid_email") return "invalid_email";
    return "unavailable";
  }
  if (!response.ok) return "unavailable";
  return "accepted";
}
