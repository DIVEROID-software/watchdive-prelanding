import { useEffect, useId, useMemo, useRef, useState } from "react";
import { phoneCountries, searchPhoneCountries, defaultPhoneCountry } from "@/lib/phoneNumbers";
import { phoneOptInCopy } from "@/lib/phoneOptInCopy";
import { readGeoCountry } from "@/lib/consentRegion";
import type { Locale } from "@/lib/i18n/locale";

export function PhoneNumberFields({
  locale,
  phone,
  onPhone,
  country,
  onCountry,
  disabled = false,
  invalid = false,
}: {
  locale: Locale;
  phone: string;
  onPhone: (value: string) => void;
  country: string;
  onCountry: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const copy = phoneOptInCopy[locale];
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const suggested = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const countries = useMemo(() => phoneCountries(locale), [locale]);
  const options = useMemo(() => searchPhoneCountries(countries, query), [countries, query]);
  const selected = countries.find((item) => item.code === country) || countries[0];
  useEffect(() => {
    if (suggested.current) return;
    suggested.current = true;
    onCountry(defaultPhoneCountry(locale, readGeoCountry()));
  }, [locale, onCountry]); // Initial suggestion only; never replace a user's selection.
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  const choose = (code: string) => {
    onCountry(code);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="wd-phone-fields" data-clarity-mask="true">
      <div
        ref={root}
        className="wd-country-picker"
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
            setOpen(false);
        }}
      >
        <label id={`${id}-country-label`}>{copy.country}</label>
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-countries`}
          aria-labelledby={`${id}-country-label ${id}-selection`}
          className="wd-country-trigger"
          onClick={() => {
            setOpen(!open);
            setQuery("");
            setActive(0);
          }}
        >
          <span id={`${id}-selection`}>
            <b>{selected.dial}</b>
            <span>{selected.name}</span>
          </span>
          <span aria-hidden>⌄</span>
        </button>
        {open && (
          <div className="wd-country-menu">
            <input
              ref={search}
              type="search"
              role="combobox"
              autoComplete="off"
              value={query}
              aria-label={copy.search}
              placeholder={copy.search}
              aria-expanded={true}
              aria-autocomplete="list"
              aria-controls={`${id}-countries`}
              aria-activedescendant={options[active] ? `${id}-${active}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  trigger.current?.focus();
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) =>
                    Math.max(0, Math.min(options.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))),
                  );
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (options[active]) choose(options[active].code);
                }
              }}
            />
            <div
              id={`${id}-countries`}
              role="listbox"
              aria-label={copy.country}
              className="wd-country-list"
            >
              {options.map((option, index) => (
                <button
                  key={option.code}
                  id={`${id}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={country === option.code}
                  data-active={active === index || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option.code)}
                >
                  <span>{option.name}</span>
                  <b>{option.dial}</b>
                </button>
              ))}
              {!options.length && (
                <p className="wd-country-empty" role="status">
                  {copy.empty}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="wd-phone-number">
        <label htmlFor={`${id}-number`}>{copy.number}</label>
        <input
          id={`${id}-number`}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={40}
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          placeholder={locale === "ko" ? "010 1234 5678" : copy.number}
        />
      </div>
    </div>
  );
}
