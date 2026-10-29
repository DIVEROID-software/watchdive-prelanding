import { createFileRoute, Link } from "@tanstack/react-router";

import { homePath, privacyPath } from "@/lib/i18n/locale";
import { legalHead } from "@/lib/i18n/seo";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";

export const Route = createFileRoute("/terms")({
  head: () => legalHead("en", "terms"),
  component: TermsPage,
});

export function TermsPage() {
  const locale = useCurrentLocale();
  const messages = useFrozenLandingMessages();
  const copy = messages.terms;
  const merchant = messages.privacy;
  const changeDisclaimer = splitChangeDisclaimer(copy.s2Body);
  const privacyReference = splitAround(copy.s3Body, copy.s3PrivacyLink);
  const contact = splitAround(copy.s7Body, "help@diveroid.com");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <Link
          to={homePath(locale)}
          className="text-body text-primary underline-offset-4 hover:underline"
        >
          {copy.back}
        </Link>
        <h1 className="mt-6 text-title">{copy.h1}</h1>
        <p className="mt-3 text-caption text-muted-foreground">
          <strong>{copy.effectiveLabel}</strong> {copy.effectiveDate}
        </p>

        <div className="prose-content mt-10 space-y-6 text-body leading-relaxed text-foreground/90">
          <p>{copy.intro}</p>

          <Section title={copy.s1Title}>
            <p>{copy.s1Body}</p>
          </Section>

          <Section title={copy.s2Title}>
            <p>
              {changeDisclaimer[0]}
              <strong>{changeDisclaimer[1]}</strong>
              {changeDisclaimer[2]}
            </p>
          </Section>

          <Section title={copy.s3Title}>
            <p>
              {privacyReference[0]}
              <Link to={privacyPath(locale)} className="text-primary underline underline-offset-4">
                {copy.s3PrivacyLink}
              </Link>
              {privacyReference[2]}
            </p>
          </Section>

          <Section title={copy.s4Title}>
            <p>{copy.s4Body}</p>
          </Section>

          <Section title={copy.s5Title}>
            <p>{copy.s5Body1}</p>
            <p>{copy.s5Body2}</p>
          </Section>

          <Section title={copy.s6Title}>
            <p>{copy.s6Body}</p>
          </Section>

          <Section title={copy.s7Title}>
            <p>{merchant.s1Company}</p>
            <p>{merchant.s1Reg}</p>
            <p>{merchant.s1Addr}</p>
            <p>
              {contact[0]}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:help@diveroid.com"
              >
                help@diveroid.com
              </a>
              {contact[2]}
            </p>
          </Section>

          <hr className="border-border" />
          <p className="text-caption italic text-muted-foreground">{copy.footerLine}</p>
        </div>
      </article>
    </div>
  );
}

const CHANGE_DISCLAIMERS = [
  "may change",
  "변경될 수 있습니다",
  "可能在 Kickstarter 众筹之前或期间发生变更",
  "可能在 Kickstarter 募資之前或期間變更",
  "変更される可能性があります",
  "pueden cambiar",
  "peuvent changer",
  "können sich vor oder während der Kickstarter-Kampagne ändern",
  "podem mudar",
  "kunnen veranderen",
] as const;

function splitChangeDisclaimer(value: string): readonly [string, string, string] {
  const highlight = CHANGE_DISCLAIMERS.find((candidate) => value.includes(candidate));
  return highlight ? splitAround(value, highlight) : ["", value, ""];
}

function splitAround(value: string, needle: string): readonly [string, string, string] {
  const index = value.indexOf(needle);
  if (index < 0) return [value, "", ""];
  return [value.slice(0, index), needle, value.slice(index + needle.length)];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-heading">{title}</h2>
      {children}
    </section>
  );
}
