import type { Locale } from "@/lib/i18n/locale";
import { localizePath, termsPath } from "@/lib/i18n/locale";
import { conversionCopy } from "@/lib/conversionCopy";
import { earlyBirdRace } from "@/lib/earlyBirdRace";
import { fill, referralCopy } from "@/lib/referral/copy";
import { REFERRAL_TIERS } from "@/lib/referral/program";
import { formatOfferPrice, copyValues } from "@/lib/referral/values";
import { reservationCopy } from "@/components/reservation/copy";
import { ONSITE_OFFER_COPY } from "@/components/reservation/onsite-copy";
import { TOTAL_BEFORE_SHIPPING_TAX_USD } from "@/components/reservation/pricing";
import { teamLimitParagraph } from "@/components/referral/PriceGoal";

/**
 * Published gates only. No checkout button: the $3 payment stays on the
 * verified reservation card. Root can bind the data-analytics-hook values
 * later; this component does not send them.
 *
 * One spelling of the public price per language, matching formatOfferPrice.
 */
const HEADINGS: Record<Locale, {
  title: string;
  public: string;
  reservation: string;
  buddy: string;
}> = {
  en: {
    title: "The $149 launch price",
    public: "Free launch alert",
    reservation: "Optional $3 reservation",
    buddy: "{goal} confirmed friends",
  },
  ko: {
    title: "$149 출시 가격",
    public: "무료 출시 알림",
    reservation: "선택 $3 예약",
    buddy: "인증한 친구 {goal}명",
  },
  "zh-CN": {
    title: "$149 发布价",
    public: "免费上线通知",
    reservation: "可选 $3 预约",
    buddy: "已确认的朋友 {goal} 位",
  },
  "zh-TW": {
    title: "$149 上市價",
    public: "免費上線通知",
    reservation: "可選的 $3 預約",
    buddy: "已確認的朋友 {goal} 位",
  },
  ja: {
    title: "149ドルの発売価格",
    public: "無料の公開通知",
    reservation: "任意の$3予約",
    buddy: "確認した友だち{goal}人",
  },
  es: {
    title: "El precio de lanzamiento de $149",
    public: "Aviso de lanzamiento gratis",
    reservation: "Reserva opcional de $3",
    buddy: "{goal} amigos confirmados",
  },
  fr: {
    title: "Le prix de lancement de 149 $",
    public: "Alerte de lancement gratuite",
    reservation: "Réservation facultative de 3 $",
    buddy: "{goal} amis confirmés",
  },
  de: {
    title: "Der Einführungspreis von 149 $",
    public: "Kostenlose Startbenachrichtigung",
    reservation: "Optionale Reservierung für $3",
    buddy: "{goal} bestätigte Freunde",
  },
  "pt-BR": {
    title: "O preço de lançamento de US$ 149",
    public: "Aviso de lançamento grátis",
    reservation: "Reserva opcional de $3",
    buddy: "{goal} amigos confirmados",
  },
  nl: {
    title: "De lanceringsprijs van $149",
    public: "Gratis lanceringsalert",
    reservation: "Optionele reservering van $3",
    buddy: "{goal} bevestigde vrienden",
  },
};

/** The reservation choice on /verify uses this same optional-$3 heading. */
export function reservationChoiceTitle(locale: Locale): string {
  return HEADINGS[locale].reservation;
}

function teamGoal(): number {
  const team = REFERRAL_TIERS.find((tier) => tier.id === "team");
  if (!team) throw new Error("Dive Team tier is missing");
  return team.minFriends;
}

export function PricePaths({ locale, referralOn }: { locale: Locale; referralOn: boolean }) {
  const headings = HEADINGS[locale];
  const offer = ONSITE_OFFER_COPY[locale];
  const reservation = reservationCopy(locale);
  const rules = referralCopy(locale);
  const values = copyValues(locale);
  const goal = teamGoal();
  const totalNote = reservation.terms.find((line) => line.includes(TOTAL_BEFORE_SHIPPING_TAX_USD));
  const feeDetails = reservation.terms.filter((line) => line !== totalNote);
  return (
    <section
      className="wd-price-paths"
      data-price-paths=""
      data-analytics-hook="price_paths"
      data-referral-program={referralOn ? "on" : "off"}
      aria-label={headings.title}
    >
      <h3>{headings.title}</h3>
      <ol>
        <li data-price-path="public" data-analytics-hook="price_path">
          <h4>{headings.public}</h4>
          <p>{earlyBirdRace(locale, formatOfferPrice(locale))}</p>
          <p>{conversionCopy[locale].terms}</p>
        </li>
        {referralOn && (
          <li data-price-path="buddy" data-analytics-hook="price_path">
            <h4>{fill(headings.buddy, { goal })}</h4>
            <p>{fill(rules.tiers.team.reward, values)}</p>
            <details data-analytics-hook="price_path_details" data-price-path="buddy">
              <summary>{rules.card.rulesLink}</summary>
              <p>{fill(teamLimitParagraph(rules), values)}</p>
              <a href={localizePath("/buddy-rules", locale)} data-analytics-hook="buddy_rules">{rules.card.rulesLink}</a>
            </details>
          </li>
        )}
        <li data-price-path="reservation" data-analytics-hook="price_path">
          <h4>{headings.reservation}</h4>
          <p>{offer.body}</p>
          <p>{offer.separate}</p>
          {totalNote && <p data-price-total="152">{totalNote}</p>}
          <p>{offer.noCharge}</p>
          <details data-analytics-hook="price_path_details" data-price-path="reservation">
            <summary>{reservation.termsHeading}</summary>
            {feeDetails.map((line) => <p key={line}>{line}</p>)}
            <p>{offer.refund}</p>
          </details>
        </li>
      </ol>
      <p>
        <a href={termsPath(locale)} data-analytics-hook="price_terms">{reservation.siteTerms}</a>
      </p>
    </section>
  );
}
