import type { Locale } from "@/lib/i18n/locale";
import { fill, referralCopy } from "@/lib/referral/copy";
import { REFERRAL_TIERS } from "@/lib/referral/program";
import { copyValues } from "@/lib/referral/values";

/** Confirmed-email progress toward the published Dive Team price. */
export type ConfirmedCountState = "loading" | "ready" | "error" | "unknown";

/** Loading and error stay words. A zero appears only when the server reported zero. */
const COUNT: Record<Locale, { unknown: string; known: string; loading: string; error: string }> = {
  en: {
    unknown: "Confirmed emails: unknown",
    known: "Confirmed emails: {count} of {goal}",
    loading: "Confirmed emails: checking",
    error: "Confirmed emails: could not check",
  },
  ko: {
    unknown: "인증된 이메일: 알 수 없음",
    known: "인증된 이메일: {count} / {goal}",
    loading: "인증된 이메일: 확인 중",
    error: "인증된 이메일: 확인하지 못함",
  },
  "zh-CN": {
    unknown: "已确认邮箱：未知",
    known: "已确认邮箱：{count} / {goal}",
    loading: "已确认邮箱：正在查询",
    error: "已确认邮箱：暂时无法查询",
  },
  "zh-TW": {
    unknown: "已確認電子郵件：未知",
    known: "已確認電子郵件：{count} / {goal}",
    loading: "已確認電子郵件：查詢中",
    error: "已確認電子郵件：無法查詢",
  },
  ja: {
    unknown: "確認済みメール：不明",
    known: "確認済みメール：{count} / {goal}",
    loading: "確認済みメール：確認中",
    error: "確認済みメール：確認できませんでした",
  },
  es: {
    unknown: "Correos confirmados: desconocido",
    known: "Correos confirmados: {count} de {goal}",
    loading: "Correos confirmados: consultando",
    error: "Correos confirmados: no se pudo consultar",
  },
  fr: {
    unknown: "E-mails confirmés : inconnu",
    known: "E-mails confirmés : {count} sur {goal}",
    loading: "E-mails confirmés : vérification en cours",
    error: "E-mails confirmés : vérification impossible",
  },
  de: {
    unknown: "Bestätigte E-Mails: unbekannt",
    known: "Bestätigte E-Mails: {count} von {goal}",
    loading: "Bestätigte E-Mails: wird geprüft",
    error: "Bestätigte E-Mails: Prüfung fehlgeschlagen",
  },
  "pt-BR": {
    unknown: "E-mails confirmados: desconhecido",
    known: "E-mails confirmados: {count} de {goal}",
    loading: "E-mails confirmados: verificando",
    error: "E-mails confirmados: não foi possível verificar",
  },
  nl: {
    unknown: "Bevestigde e-mails: onbekend",
    known: "Bevestigde e-mails: {count} van {goal}",
    loading: "Bevestigde e-mails: wordt gecontroleerd",
    error: "Bevestigde e-mails: controle mislukt",
  },
};

export function teamGoalFriends(): number {
  const team = REFERRAL_TIERS.find((tier) => tier.id === "team");
  if (!team) throw new Error("Dive Team tier is missing");
  return team.minFriends;
}

function rulesParagraphs(copy: ReturnType<typeof referralCopy>): string[] {
  return copy.rules.sections.flatMap((section) => section.paragraphs);
}

/** The published five-friend reward, including app, late pledge, and Pledge Manager. */
export function teamLimitParagraph(copy: ReturnType<typeof referralCopy>): string {
  const hits = rulesParagraphs(copy).filter(
    (paragraph) => paragraph.includes("{price}") && paragraph.includes("{seats}"),
  );
  if (hits.length !== 1) throw new Error("Dive Team rules paragraph missing");
  return hits[0];
}

/** The existing sentence that a tier you were told about is kept. */
export function keptTierParagraph(copy: ReturnType<typeof referralCopy>): string {
  const section = copy.rules.sections.find((item) =>
    item.paragraphs.some((paragraph) => paragraph.includes("{cap}")),
  );
  const paragraph = section?.paragraphs.at(-1);
  if (!paragraph || paragraph.includes("{cap}")) throw new Error("kept-tier sentence missing");
  return paragraph;
}

export function PriceGoal({
  locale,
  credited,
  held = null,
  placement,
  countState = "ready",
}: {
  locale: Locale;
  /** Credited confirmed emails. Null means the server has not said. */
  credited: number | null;
  /** Held-tier floor from the status card. Null when this surface has no status. */
  held?: number | null;
  placement: "verify_card" | "signup_success";
  /** Loading and error are not a count. Ready with null stays unknown. */
  countState?: ConfirmedCountState;
}) {
  const goal = teamGoalFriends();
  const copy = referralCopy(locale);
  const values = copyValues(locale);
  const known = countState === "ready" && credited !== null && Number.isSafeInteger(credited) && credited >= 0;
  const countText = countState === "loading"
    ? COUNT[locale].loading
    : countState === "error"
      ? COUNT[locale].error
      : known
        ? fill(COUNT[locale].known, { count: credited, goal })
        : COUNT[locale].unknown;
  const emails = countState === "loading" || countState === "error"
    ? countState
    : known ? String(credited) : "unknown";
  const tierHeld = held !== null && held >= goal;
  const showHeldNote = countState !== "loading" && countState !== "error" && tierHeld && (!known || credited < goal);
  return (
    <section
      className="wd-price-goal mt-3 border-[3px] border-[#65ceee] bg-[#120c2e] p-3 text-white"
      data-analytics-hook="buddy_price_goal"
      data-share-placement={placement}
      data-price-goal="team"
      data-confirmed-emails={emails}
      data-held-team={countState === "loading" || countState === "error" || held === null ? undefined : tierHeld ? "held" : "below"}
      aria-live="polite"
    >
      <h3 className="text-sm font-semibold leading-snug text-[#65ceee]">{copy.tiers.team.name}</h3>
      <p className="mt-1 text-sm font-semibold leading-snug">{fill(copy.tiers.team.reward, values)}</p>
      <p className="mt-1 text-sm" data-confirmed-label="">{countText}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/75" data-count-rule="">{copy.countingNote}</p>
      <details className="mt-1" data-price-goal-limits="">
        <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-[#65ceee]">{copy.card.rulesLink}</summary>
        <p className="mt-1 text-xs leading-relaxed text-white/75">{fill(teamLimitParagraph(copy), values)}</p>
      </details>
      {showHeldNote && (
        <p className="mt-1 text-xs leading-relaxed" data-held-note="">{fill(keptTierParagraph(copy), values)}</p>
      )}
    </section>
  );
}
