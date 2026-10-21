import type { Locale } from "@/lib/i18n/locale";
import { homePath } from "@/lib/i18n/locale";
import { fill, referralCopy } from "@/lib/referral/copy";
import { copyValues } from "@/lib/referral/values";

/**
 * Official Buddy Invite rules. Text and numbers come only from copy.ts and
 * program.ts (via copyValues), so the page cannot state a rule the counter does
 * not enforce. Layout mirrors the terms page.
 */
export function RulesPage({ locale }: { locale: Locale }) {
  const copy = referralCopy(locale);
  const values = copyValues(locale);
  const back = referralCopy(locale).programName;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <a href={homePath(locale)} className="text-body text-primary underline-offset-4 hover:underline">
          ← {back}
        </a>
        <h1 className="mt-6 text-title">{copy.rules.title}</h1>
        <p className="mt-3 text-caption text-muted-foreground">{copy.rules.updated}</p>

        <div className="prose-content mt-10 space-y-6 text-body leading-relaxed text-foreground/90">
          {copy.rules.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-heading">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{fill(paragraph, values)}</p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
