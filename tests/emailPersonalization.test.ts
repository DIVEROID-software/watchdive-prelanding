import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { RESERVATION_COPY } from "../src/lib/reservation-mail/copy.ts";
import { renderReservationMail } from "../src/lib/reservation-mail/render.ts";
import { DRIP_STAGES, type DripStage } from "../src/lib/reservation-drip/policy.ts";
import { DRIP_COPY_HASH, renderDripMail } from "../src/lib/reservation-drip/render.ts";
import {
  PREVIEW_ASSET_ORIGIN,
  RESERVATION_EMAIL_SEGMENTS,
  rewritePreviewAssetUrls,
  segmentedHeroPath,
  type ReservationEmailSegment,
} from "../src/lib/reservation-drip/media.ts";
import { D1_DEMAND_COPY, PERSONALIZED_COPY } from "../src/lib/reservation-drip/personalized-copy.ts";
import { main } from "../scripts/reservation-drip.ts";

const DECO = /decompression|no-deco|\bNDL\b|무감압|감압|免减压|免減壓|無減圧|減圧|décompression|descompres|Dekompression|descompress/i;
const DEADLINE = /last chance|ends tonight|only today|sell(?:ing)? out|almost gone|매진|급증|폭증|마감|最后机会|最後機會|最後のチャンス|dernière chance|última oportunidad|letzte Chance|última chance|only\s+\d+\s+left|\b100\s+backers\b/i;
const SERIES = /Last note|\$149 still open|환영합니다\. 출시가는|그대로 열려|안내를 닫는|last email|마지막 안내|시리즈의 마지막|próxima el |próxima la |prochaine la |prochaine l'/i;
const LAYOUT: Record<DripStage, string> = { d0: "welcome", d1: "proof", d3: "urgency", d7: "assurance" };
const CONTINUING: Record<Locale, RegExp> = {
  en: /Launch alert signups keep coming in/,
  ko: /사전 알림 신청이 계속 늘고 있어요/,
  ja: /発売案内の申し込みは増え続けています/,
  "zh-CN": /上线提醒的申请还在增加/,
  "zh-TW": /上市提醒的申請還在增加/,
  es: /Las altas del aviso de lanzamiento siguen aumentando/,
  fr: /Les inscriptions à l'alerte de lancement continuent d'augmenter/,
  de: /Die Anmeldungen zur Startmitteilung nehmen weiter zu/,
  "pt-BR": /As inscrições do aviso de lançamento continuam aumentando/,
};
const RATE = /every day|grows every|매일|毎日|每天|cada día|chaque jour|jeden Tag|todos os dias|todo dia|늘어납|쌓입니다|증가|급증|폭증|매진/i;
const SURFACE: Record<Locale, string> = {
  en: "surface interval",
  ko: "수면 휴식",
  ja: "水面休息",
  "zh-CN": "水面休息",
  "zh-TW": "水面休息",
  es: "intervalo en superficie",
  fr: "intervalle de surface",
  de: "Oberflächenpause",
  "pt-BR": "intervalo de superfície",
};
const DEPTH: Record<Locale, string> = {
  en: "depth",
  ko: "수심",
  ja: "水深",
  "zh-CN": "水深",
  "zh-TW": "水深",
  es: "profundidad",
  fr: "profondeur",
  de: "Tiefe",
  "pt-BR": "profundidade",
};
const DIVE_TIME: Record<Locale, RegExp> = {
  en: /time/i,
  ko: /시간/,
  ja: /時間/,
  "zh-CN": /时间/,
  "zh-TW": /時間/,
  es: /tiempo/,
  fr: /temps/,
  de: /Zeit/,
  "pt-BR": /tempo/,
};
const LOGBOOK: Record<Locale, string> = {
  en: "logbook",
  ko: "로그북",
  ja: "ログブック",
  "zh-CN": "日志",
  "zh-TW": "日誌",
  es: "diario",
  fr: "carnet",
  de: "Logbuch",
  "pt-BR": "diário",
};
const COMPASS: Record<Locale, string> = {
  en: "compass",
  ko: "나침반",
  ja: "コンパス",
  "zh-CN": "指南针",
  "zh-TW": "指南針",
  es: "brújula",
  fr: "compas",
  de: "Kompass",
  "pt-BR": "bússola",
};
const COMPUTER: Record<Locale, string> = {
  en: "dive computer",
  ko: "다이브 컴퓨터",
  ja: "ダイブコンピューター",
  "zh-CN": "潜水电脑",
  "zh-TW": "潛水電腦",
  es: "ordenador de buceo",
  fr: "ordinateur de plongée",
  de: "Tauchcomputer",
  "pt-BR": "computador de mergulho",
};
const NOSUB: Record<Locale, RegExp> = {
  en: /no extra subscription/i,
  ko: /추가 구독/,
  ja: /サブスクリプション/,
  "zh-CN": /无需额外订阅/,
  "zh-TW": /無需額外訂閱/,
  es: /suscripción adicional/,
  fr: /abonnement supplémentaire/,
  de: /zusätzliches Abo/,
  "pt-BR": /assinatura extra/,
};

function mailInput(locale: Locale, segment?: ReservationEmailSegment) {
  return {
    locale,
    ...(segment ? { segment } : {}),
    inviteUrl: `https://watchdive.diveroid.com/reservation?lang=${locale}#invite=preview-token`,
    unsubscribeUrl: "https://watchdive.diveroid.com/unsubscribe",
    privacyUrl: "https://watchdive.diveroid.com/privacy",
    termsUrl: "https://watchdive.diveroid.com/terms",
  };
}

function pricePattern(locale: Locale, amount: 149 | 200 | 3): RegExp {
  return locale === "fr" ? new RegExp(`${amount} \\$`) : new RegExp(`\\$${amount}\\b`);
}

test("omitted segment stays on the legacy underwater invite", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const input = mailInput(locale);
    const legacy = renderReservationMail(input);
    assert.equal(renderDripMail("d0", input).html, legacy.html);
    assert.match(legacy.html, /\/brand\/reservation\/watchdive-underwater\.jpg/);
    assert.equal(legacy.html.includes("/brand/reservation/segmented/"), false);
    assert.equal(legacy.html, renderReservationMail(input).html);
  }
});

test("108 segmented mails vary by stage and signup segment", () => {
  const seen = new Set<string>();
  for (const segment of RESERVATION_EMAIL_SEGMENTS) {
    for (const locale of SUPPORTED_LOCALES) {
      const subjects = new Set<string>();
      const heroes = new Set<string>();
      for (const stage of DRIP_STAGES) {
        const mail = renderDripMail(stage, mailInput(locale, segment));
        const again = renderDripMail(stage, mailInput(locale, segment));
        assert.deepEqual(mail, again);
        if (stage === "d0") assert.deepEqual(mail, renderReservationMail(mailInput(locale, segment)));
        const copy = RESERVATION_COPY[locale];
        const blob = `${mail.subject}\n${mail.text}\n${mail.html}`;
        const hero = segmentedHeroPath(segment, stage);
        seen.add(`${stage}.${segment}.${locale}`);
        subjects.add(mail.subject);
        heroes.add(hero);
        assert.equal(/[\r\n]/.test(mail.subject), false);
        assert.equal(blob.includes(copy.disclosure), false);
        assert.equal(blob.includes(copy.feeNote), false);
        assert.equal(blob.includes("US$152"), false);
        assert.equal(mail.html.includes("<script"), false);
        assert.equal(mail.html.includes("font-size:64px"), false);
        assert.match(mail.html, new RegExp(`data-layout="${LAYOUT[stage]}"`));
        assert.match(mail.html, /padding:34px!important/);
        assert.match(mail.html, /@media only screen and \(max-width:480px\)/);
        assert.match(mail.html, /width="237"/);
        assert.match(mail.html, /watchdive-primary@1x\.png\?v=2\.6\.1/);
        assert.match(mail.html, /alt="WatchDive"/);
        assert.match(mail.html, /DIVEROID LTD/);
        assert.ok(mail.html.includes(copy.unsubscribe));
        assert.ok(mail.html.includes(copy.privacy));
        assert.ok(mail.html.includes(copy.terms));
        assert.equal(mail.html.split(copy.button).length - 1, 1, `${segment} ${locale} ${stage} cta`);
        assert.match(mail.html, new RegExp(`src="https://watchdive\\.diveroid\\.com${hero.replaceAll(".", "\\.")}"`));
        assert.equal(mail.html.includes("127.0.0.1"), false);
        const draft = PERSONALIZED_COPY[segment][locale][stage];
        const demandLocales = locale === "ko" || locale === "en";
        if (stage === "d1" && demandLocales) {
          assert.equal(draft.demand, D1_DEMAND_COPY[locale]);
          assert.ok(mail.html.indexOf(draft.sentence2) < mail.html.indexOf(draft.demand!));
          assert.ok(mail.html.indexOf(draft.demand!) < mail.html.indexOf(copy.button));
          assert.ok(mail.text.indexOf(draft.sentence2) < mail.text.indexOf(draft.demand!));
          assert.ok(mail.text.indexOf(draft.demand!) < mail.text.indexOf(copy.button));
          assert.equal(mail.html.split(draft.demand!).length - 1, 1);
          assert.equal(mail.text.split(draft.demand!).length - 1, 1);
          assert.doesNotMatch(blob.replaceAll(draft.demand!, ""), DEADLINE);
          assert.doesNotMatch(blob, /\$299|December|12월|마감|today|오늘만/);
        } else {
          assert.equal(draft.demand, undefined);
          assert.equal(blob.includes(D1_DEMAND_COPY.ko), false);
          assert.equal(blob.includes(D1_DEMAND_COPY.en), false);
          assert.doesNotMatch(blob, DEADLINE);
        }
        assert.doesNotMatch(blob, SERIES);
        assert.doesNotMatch(blob, /\$299|\$179|free shipping|체크아웃|영수증/);
        assert.ok(draft.eyebrow.length <= 22, `${segment} ${locale} ${stage} eyebrow ${draft.eyebrow}`);
        for (const value of Object.values(draft)) {
          const stripped = value.replace(/\$?(?:100|149|200|3)\b/g, "").replace(/\b(?:100|149|200|3)\s*\$/g, "");
          assert.equal(/\d/.test(stripped), false, `${segment} ${locale} ${stage} ${value}`);
        }
        assert.ok(blob.includes(draft.eyebrow) && blob.includes(draft.chip) && mail.html.includes(draft.imageAlt));
        const imgAt = mail.html.indexOf("<img src=\"https://watchdive.diveroid.com/brand/reservation/segmented/");
        const titleAt = mail.html.indexOf("<h1");
        const yellowAt = mail.html.toLowerCase().indexOf("#ffe55c");
        if (stage === "d0") {
          assert.ok(hero.endsWith(".gif"));
          assert.ok(yellowAt !== -1 && yellowAt < imgAt && imgAt < titleAt);
        } else if (stage === "d1") {
          assert.ok(hero.endsWith(".jpg"));
          assert.equal(yellowAt, -1);
          assert.ok(imgAt < titleAt);
        } else if (stage === "d3") {
          assert.ok(hero.endsWith(".jpg"));
          assert.ok(yellowAt !== -1 && yellowAt < imgAt && imgAt < titleAt);
          assert.match(blob, pricePattern(locale, 149));
          assert.match(blob, pricePattern(locale, 200));
          assert.match(`${mail.subject}\n${mail.text}`, CONTINUING[locale]);
          assert.doesNotMatch(`${mail.subject}\n${mail.text}`, RATE);
        } else {
          assert.equal(hero.endsWith(segment === "freediving" ? ".gif" : ".jpg"), true);
          assert.equal(yellowAt, -1);
          assert.ok(titleAt !== -1 && titleAt < imgAt);
          assert.match(blob, pricePattern(locale, 149));
          assert.match(`${mail.subject}\n${mail.text}`, CONTINUING[locale]);
          assert.doesNotMatch(`${mail.subject}\n${mail.text}`, RATE);
          assert.doesNotMatch(mail.subject, /마감|最后机会|最後機會|最後のチャンス|dernière chance|última oportunidad|letzte Chance|última chance/i);
        }
        if (stage === "d0" || stage === "d3") {
          assert.match(blob, pricePattern(locale, 149));
          assert.match(blob, pricePattern(locale, 200));
          assert.match(blob, pricePattern(locale, 3));
        }
        if (segment === "freediving") {
          assert.doesNotMatch(blob, DECO, `${locale} ${stage}`);
          assert.equal(blob.toLowerCase().includes(COMPASS[locale].toLowerCase()), false);
          if (stage === "d1" || stage === "d7") {
            assert.ok(blob.toLowerCase().includes(DEPTH[locale].toLowerCase()));
            assert.match(blob, DIVE_TIME[locale]);
            assert.ok(blob.includes(SURFACE[locale]));
            assert.ok(blob.toLowerCase().includes(LOGBOOK[locale].toLowerCase()));
          }
        }
        if (segment === "scuba" && stage === "d1") {
          assert.ok(blob.toLowerCase().includes(COMPASS[locale].toLowerCase()));
          assert.ok(blob.toLowerCase().includes(COMPUTER[locale].toLowerCase()));
          assert.ok(blob.toLowerCase().includes(LOGBOOK[locale].toLowerCase()));
          assert.match(blob, NOSUB[locale]);
        }
        if (segment === "general") {
          assert.equal(blob.includes(SURFACE[locale]), false, `${locale} ${stage}`);
          assert.equal(blob.toLowerCase().includes(COMPASS[locale].toLowerCase()), false);
          if (stage === "d1") {
            assert.ok(blob.toLowerCase().includes(COMPUTER[locale].toLowerCase()));
            assert.ok(blob.toLowerCase().includes(LOGBOOK[locale].toLowerCase()));
            assert.match(blob, NOSUB[locale]);
          }
        }
      }
      assert.equal(subjects.size, 4, `${segment} ${locale} subjects`);
      assert.equal(heroes.size, 4, `${segment} ${locale} heroes`);
      assert.notEqual(
        renderDripMail("d1", mailInput(locale, segment)).html,
        renderDripMail("d3", mailInput(locale, segment)).html,
      );
    }
  }
  assert.equal(seen.size, 108);
  assert.match(DRIP_COPY_HASH, /^[a-f0-9]{64}$/);
  assert.equal(DRIP_COPY_HASH, DRIP_COPY_HASH);
});

test("segments do not share a body, and a bad segment is refused", () => {
  const ko = mailInput("ko", "scuba");
  assert.notEqual(renderDripMail("d1", ko).html, renderDripMail("d1", mailInput("ko", "freediving")).html);
  assert.notEqual(renderDripMail("d0", ko).html, renderDripMail("d0", mailInput("ko", "general")).html);
  assert.throws(() => renderReservationMail({ ...mailInput("en"), segment: "pool" as ReservationEmailSegment }));
});

test("preview writes 108 mails, general aliases, and local image urls only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-email-personalization-"));
  const lines: string[] = [];
  const code = await main(["--preview", "--out-dir", dir], {}, (line) => lines.push(line));
  assert.equal(code, 0);
  const summary = JSON.parse(lines[0]!);
  assert.equal(summary.samples, 108);
  assert.equal(summary.sent, 0);
  assert.equal(summary.copyHash, DRIP_COPY_HASH);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.samples, 108);
  assert.equal(manifest.sendApproved, false);
  assert.equal(manifest.draft, true);
  assert.equal(manifest.priceUsdAfterFirst100, 200);
  assert.equal(manifest.items.length, 108);
  const names = new Set(manifest.items.map((item: { file: string }) => item.file));
  assert.equal(names.size, 108);
  for (const segment of RESERVATION_EMAIL_SEGMENTS) {
    for (const locale of SUPPORTED_LOCALES) {
      for (const stage of DRIP_STAGES) {
        const file = `${stage}.${segment}.${locale}.html`;
        assert.equal(names.has(file), true);
        const html = await readFile(join(dir, file), "utf8");
        assert.match(html, new RegExp(`${PREVIEW_ASSET_ORIGIN}/brand/reservation/segmented/${segment}-${stage}\\.`));
        assert.equal(html.includes("https://watchdive.diveroid.com/brand/"), false);
        assert.match(html, new RegExp(`https://watchdive\\.diveroid\\.com/reservation\\?lang=${locale}#invite=`));
        assert.match(html, /https:\/\/hub\.diveroid\.ai\/brand-system\/communication\/assets\/product-wordmarks\/watchdive-primary@1x\.png/);
        if (segment === "general") {
          assert.equal(await readFile(join(dir, `${stage}.${locale}.html`), "utf8"), html);
        }
      }
    }
  }
  const files = await readdir(dir);
  assert.equal(files.filter((name) => name.endsWith(".html") && name.split(".").length === 4).length, 108);
  assert.equal(names.has("d0.en.html"), false);
  const sample = await readFile(join(dir, "d0.freediving.ko.html"), "utf8");
  assert.equal(rewritePreviewAssetUrls(sample), sample);
});
