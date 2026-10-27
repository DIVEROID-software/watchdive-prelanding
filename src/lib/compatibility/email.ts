import type { Locale } from "../i18n/locale.ts";
import { RETARGETING_COPY } from "../../components/retargeting/copy.ts";
import { prepareCompatibilityRequest, type CompatibilityContext } from "./context.ts";
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
/** Insert into the existing initial verification email. Keep its signed CTA and
 * idempotency key; this fragment never sends a second message or constructs a token. */
export function compatibilityEmailFragment(input: CompatibilityContext, signupLocale?: Locale) {
  const context = prepareCompatibilityRequest(input);
  if (!context) throw new Error("Invalid compatibility context");
  const language = signupLocale ?? context.locale;
  const copy = RETARGETING_COPY[language];
  const model =
    context.modelId === "not-listed"
      ? copy.other
      : context.modelId === "apple-watch-non-ultra"
        ? copy.otherApple
        : context.model;
  const result =
    context.result === "listed-housing"
      ? copy.listed
      : context.result === "planned-app-only"
        ? copy.planned
        : copy.unconfirmed;
  const lines = [copy.checkerTitle, `${copy.model}: ${model}`, result, copy.verify];
  const paragraphs = lines
    .map((line, index) => {
      const gap = index === lines.length - 1 ? "0" : "8px";
      return `<p style="margin:0 0 ${gap};font-size:14px;line-height:1.55;color:#1a1238;">${escapeHtml(line)}</p>`;
    })
    .join("");
  return {
    text: lines.join("\n\n"),
    html:
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;border-collapse:collapse;"><tr>' +
      `<td style="padding:12px 14px;border:2px solid #111111;background-color:#EEF9FF;"><section lang="${language}">${paragraphs}</section></td>` +
      "</tr></table>",
  };
}
