import { LOCALE_PREFERENCE_COOKIE } from "@/lib/i18n/auto-locale";
import { isLocale, LANGUAGE_OPTIONS, switchLocalePath } from "@/lib/i18n/locale";
import { useCurrentLocale } from "@/lib/i18n/use-current-locale";

/**
 * The top-banner language picker (founder-requested, 2026-08-01).
 *
 * A native <select> rather than a custom dropdown: it is keyboard- and
 * screen-reader-correct for free and renders as the platform picker on phones,
 * where most of this page's traffic lives. Picking a language stores the
 * explicit choice in the same cookie the server's auto-locale honors, then
 * performs a full navigation so the SSR HTML, <html lang> and SEO tags all
 * arrive already in the chosen language.
 */
export function LanguageSwitcher() {
  const locale = useCurrentLocale();

  return (
    <label className="relative flex h-11 min-w-0 max-w-full items-center text-[#F6FAFC]">
      <svg
        aria-hidden
        className="pointer-events-none absolute left-3 size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <select
        aria-label="Language"
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (!isLocale(next)) return;
          document.cookie = `${LOCALE_PREFERENCE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
          window.location.assign(switchLocalePath(window.location.pathname, next));
        }}
        className="h-11 min-h-11 w-max min-w-11 max-w-full cursor-pointer appearance-none rounded-full border border-white/45 bg-[#201748] py-0 pl-9 pr-8 text-caption text-[#F6FAFC] outline-none hover:bg-white/10 focus:ring-2 focus:ring-[#36A9E1] [&>option]:bg-white [&>option]:text-[#10212E]"
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.locale} value={option.locale}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        className="pointer-events-none absolute right-3 size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
