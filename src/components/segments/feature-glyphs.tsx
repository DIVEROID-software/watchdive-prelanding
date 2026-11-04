import type { FeatureIcon } from "@/lib/segments/feature-carousel";

/** Outline glyphs for the feature rows. Decorative; the line text is the name. */
export function FeatureGlyph({ name }: { name: FeatureIcon }) {
  return (
    <svg className="wd-feature-icon" viewBox="0 0 24 24" aria-hidden="true">
      {glyph(name)}
    </svg>
  );
}

function glyph(name: FeatureIcon) {
  switch (name) {
    case "depth":
      return <path d="M12 3v13M7.5 12.5 12 17.5l4.5-5M6 21h12" />;
    case "temperature":
      return <path d="M10 13.2V6.2a2 2 0 1 1 4 0v7a3.2 3.2 0 1 1-4 0Z M12 8.2v4.2" />;
    case "deco":
      return <path d="M12 20.5a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M8.5 12.5h7" />;
    case "ndl":
      return <path d="M12 20.5a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M12 8.2V12l2.8 2" />;
    case "safety-stop":
      return <path d="M8.2 3.8h7.6L20.2 8.2v7.6l-4.4 4.4H8.2L3.8 15.8V8.2Z M12 8v4.2 M12 16.2h.01" />;
    case "ascent":
      return <path d="M12 20V6.5M7 11.2 12 6.2l5 5" />;
    case "deep-stop":
      return <path d="M12 4v11.5M7 11.2 12 16.2l5-5M6 20.5h12" />;
    case "compass":
      return <path d="M12 20.5a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M12 8.2 13.6 13 12 15.2 10.4 13Z" />;
    case "nitrox":
      return <path d="M9 8.5h6V20H9Z M10.2 8.5V6.2h3.6V8.5 M12 12.2v4" />;
    case "heading":
      return <path d="M12 20a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z M12 3.2v2.4 M12 18.4V20.8 M3.2 12h2.4 M18.4 12H20.8 M12 9.2v2.6" />;
    case "scuba":
      return <path d="M9 8h5.2v11H9Z M10.2 8V5.8h2.8V8 M4 19.5c1.6 0 1.6-1.6 3.2-1.6S10.4 19.5 12 19.5s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6" />;
    case "freedive":
      return <path d="M3.5 9.5c1.8 0 1.8-2 3.6-2s1.8 2 3.6 2 1.8-2 3.6-2 1.8 2 3.6 2 1.8-2 3.6-2 M3.5 15.5c1.8 0 1.8-2 3.6-2s1.8 2 3.6 2 1.8-2 3.6-2 1.8 2 3.6 2 1.8-2 3.6-2" />;
    case "battery":
      return <path d="M7 7.5h8.5V19H7Z M10 7.5V5h3v2.5 M9.2 15.2h4.2" />;
    default:
      return null;
  }
}
