import type { Locale } from "@/lib/i18n/locale";
import { homePath, privacyPath } from "@/lib/i18n/locale";
import { fill, referralCopy } from "@/lib/referral/copy";
import { copyValues } from "@/lib/referral/values";

// The policy's own words (`rules.privacyLink`, which copy.ts places exactly
// once in the privacy paragraph) link to its Buddy Invite section. Any other
// paragraph, or a copy edit that drops the words, renders as plain text.
function withPrivacyLink(text: string, locale: Locale, phrase: string) {
  const at = phrase ? text.indexOf(phrase) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a
        href={`${privacyPath(locale)}#buddy-invite`}
        className="text-primary underline underline-offset-4"
      >
        {phrase}
      </a>
      {text.slice(at + phrase.length)}
    </>
  );
}

/**
 * Official Buddy Invite rules. Text and numbers come only from copy.ts and
 * program.ts (via copyValues), so the page cannot state a rule the counter does
 * not enforce. Layout mirrors the terms page.
 */
export function RulesPage({ locale, back = "← WatchDive" }: { locale: Locale; back?: string }) {
  const copy = referralCopy(locale);
  const values = copyValues(locale);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <a
          href={homePath(locale)}
          className="inline-flex min-h-11 items-center text-body text-primary underline-offset-4 hover:underline"
        >
          {back}
        </a>
        <h1 className="mt-6 text-title">{copy.rules.title}</h1>
        <p className="mt-3 text-caption text-muted-foreground">{copy.rules.updated}</p>

        <div className="prose-content mt-10 space-y-6 text-body leading-relaxed text-foreground/90">
          {copy.rules.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-heading">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>
                  {withPrivacyLink(fill(paragraph, values), locale, copy.rules.privacyLink)}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
