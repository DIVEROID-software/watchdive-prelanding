import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneCountry = { code: CountryCode; name: string; dial: string; search: string };
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
const aliases: Partial<Record<CountryCode, string>> = {
  US: "USA America 미국",
  GB: "UK Britain England 영국",
  KR: "Korea South Korea 대한민국 한국",
  DE: "Germany Deutschland 독일",
  AU: "Australia 호주",
  TW: "Taiwan 대만",
  HK: "Hong Kong 홍콩",
};

export function phoneCountries(locale: string): PhoneCountry[] {
  const names = new Intl.DisplayNames([locale, "en"], { type: "region" });
  const english = new Intl.DisplayNames(["en"], { type: "region" });
  const korean = new Intl.DisplayNames(["ko"], { type: "region" });
  return getCountries()
    .map((code) => {
      const name = names.of(code) || code;
      const dial = `+${getCountryCallingCode(code)}`;
      return {
        code,
        name,
        dial,
        search: fold(
          `${name} ${english.of(code)} ${korean.of(code)} ${code} ${aliases[code] || ""}`,
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function searchPhoneCountries(countries: PhoneCountry[], query: string): PhoneCountry[] {
  const term = fold(query);
  if (!term) return countries;
  const numeric = term.replace(/[+\s()-]/g, "");
  if (/^\d+$/.test(numeric)) return countries.filter((c) => c.dial.slice(1).startsWith(numeric));
  return countries.filter((c) => term.split(/\s+/).every((part) => c.search.includes(part)));
}

/** Full international paste wins over the picker; national trunk prefixes are parsed, not concatenated. */
export function normalizePhone(value: string, country?: string): string | null {
  if (value.length > 40 || !/^[+\d\s().-]+$/.test(value.trim())) return null;
  const code = getCountries().includes(country as CountryCode)
    ? (country as CountryCode)
    : undefined;
  const input = value.trim().replace(/^00/, "+");
  if (!input.startsWith("+") && !code) return null;
  const parsed = parsePhoneNumberFromString(input, { defaultCountry: code, extract: false });
  return parsed && !parsed.ext && parsed.isPossible() ? parsed.number : null;
}

export function defaultPhoneCountry(locale: string, geo?: string | null): CountryCode {
  if (geo && getCountries().includes(geo as CountryCode)) return geo as CountryCode;
  return (
    (
      {
        ko: "KR",
        "zh-CN": "CN",
        "zh-TW": "TW",
        ja: "JP",
        es: "ES",
        fr: "FR",
        de: "DE",
        "pt-BR": "BR",
      } as Record<string, CountryCode>
    )[locale] || "US"
  );
}
