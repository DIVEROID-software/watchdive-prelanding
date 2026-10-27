import { useEffect, useState } from "react";
import {
  APPLE_BUTTON_COLORS,
  APPLE_LOGO,
  GOOGLE_LOGO_PATHS,
  GOOGLE_LOGO_VIEWBOX,
  SOCIAL_SIGNUP_CSS,
  UNKNOWN_EMBEDDED_BROWSER,
  classifyEmbeddedBrowser,
  requestSocialProvider,
  socialSignupRenderModel,
  type EmbeddedBrowserAssessment,
  type SocialProvider,
  type SocialSignupButtonsProps,
  type SocialSignupRenderItem,
} from "../lib/socialSignupCopy.ts";

export type {
  EmbeddedBrowserAssessment,
  EnabledProviders,
  SocialProvider,
  SocialSignupButtonsProps,
} from "../lib/socialSignupCopy.ts";

/**
 * Continue-with-Google and Continue-with-Apple controls for the hero and offer
 * forms. The buttons are compact, the same height, and they never start a
 * request. `onProvider` is required so a caller has to own the redirect.
 */
export function SocialSignupButtons(props: SocialSignupButtonsProps) {
  const embedded = useObservedEmbeddedBrowser();
  return <SocialSignupButtonGroup {...props} embedded={embedded} />;
}

/**
 * Presentational group. `SocialSignupButtons` reads `navigator.userAgent`
 * after mount and does not accept a replacement agent. Pass `embedded` here
 * only from `classifyEmbeddedBrowser` on the real request User-Agent, or from
 * a test. Do not invent a desktop agent to reveal Google.
 */
export function SocialSignupButtonGroup({
  embedded,
  ...props
}: SocialSignupButtonsProps & { embedded: EmbeddedBrowserAssessment }) {
  const model = socialSignupRenderModel(props, embedded);
  // Unsupported Google sign-in should disappear without a warning panel.
  // Apple and the surrounding email form remain available.
  if (model.items.length === 0) return null;

  return (
    <div className="wd-social-signup" data-wd-social-signup="" data-locale={props.locale}>
      <style>{SOCIAL_SIGNUP_CSS}</style>
      {model.items.length > 0 && model.groupLabel ? (
        <div className="wd-social-group" role="group" aria-label={model.groupLabel}>
          {model.items.map((item) => (
            <ProviderButton
              key={item.provider}
              item={item}
              onActivate={() =>
                requestSocialProvider(
                  item.provider,
                  {
                    disabled: props.disabled,
                    loadingProvider: props.loadingProvider,
                    enabled: props.enabledProviders?.[item.provider] === true,
                    blocked: item.provider === "google" && embedded.blocksGoogle,
                  },
                  props.onProvider,
                )
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProviderButton({
  item,
  onActivate,
}: {
  item: SocialSignupRenderItem;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      className="wd-social-button"
      data-wd-provider={item.provider}
      data-wd-social-loading={item.busy ? "true" : undefined}
      disabled={item.disabled}
      aria-busy={item.busy || undefined}
      onClick={onActivate}
    >
      {item.provider === "google" ? <GoogleLogo /> : <AppleLogo />}
      <span className="wd-social-label">{item.label}</span>
      {item.busy ? <span className="wd-social-spinner" aria-hidden="true" /> : null}
    </button>
  );
}

function GoogleLogo() {
  return (
    <span className="wd-social-google-tile">
      <svg
        className="wd-social-logo"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={GOOGLE_LOGO_VIEWBOX}
        width="18"
        height="18"
        aria-hidden="true"
        focusable="false"
      >
        {GOOGLE_LOGO_PATHS.map((path) => (
          <path key={path.fill} fill={path.fill} d={path.d} />
        ))}
      </svg>
    </span>
  );
}

function AppleLogo() {
  return (
    <svg
      className="wd-social-logo"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={APPLE_LOGO.viewBox}
      width="16"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path fill={APPLE_BUTTON_COLORS.label} d={APPLE_LOGO.path} />
    </svg>
  );
}

function useObservedEmbeddedBrowser(): EmbeddedBrowserAssessment {
  const [embedded, setEmbedded] = useState<EmbeddedBrowserAssessment>(UNKNOWN_EMBEDDED_BROWSER);
  useEffect(() => {
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    setEmbedded(classifyEmbeddedBrowser(userAgent));
  }, []);
  return embedded;
}
