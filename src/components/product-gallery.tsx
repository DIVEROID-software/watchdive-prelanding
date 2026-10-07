import { useState } from "react";
import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import black640 from "@/assets/live/refresh/studio-black-640.webp";
import black1000 from "@/assets/live/refresh/studio-black-1000.webp";
import black1600 from "@/assets/live/refresh/studio-black-1600.webp";
import white640 from "@/assets/live/refresh/studio-white-640.webp";
import white1000 from "@/assets/live/refresh/studio-white-1000.webp";
import white1600 from "@/assets/live/refresh/studio-white-1600.webp";

const images = {
  black: { src: black640, srcSet: `${black640} 640w, ${black1000} 1000w, ${black1600} 1600w` },
  white: { src: white640, srcSet: `${white640} 640w, ${white1000} 1000w, ${white1600} 1600w` },
};

/** One responsive image, shared by mobile and desktop. No duplicate eager downloads. */
export function ProductGallery() {
  const m = useFrozenLandingMessages();
  const [color, setColor] = useState<"black" | "white">("black");
  return (
    <figure className="wd-product-gallery">
      <div className="wd-product-stage">
        <img
          {...images[color]}
          sizes="(min-width: 1024px) 540px, (min-width: 640px) 600px, calc(100vw - 40px)"
          alt={color === "black" ? m.gallery.blackAlt : m.gallery.whiteAlt}
          width={640}
          height={480}
          loading="eager"
          fetchPriority="high"
        />
      </div>
      <figcaption className="wd-product-caption">
        <span className="wd-product-name">WATCH DIVE</span>
        <div role="group" aria-label={m.gallery.label} className="wd-color-options">
          {(["black", "white"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={color === option}
              onClick={() => setColor(option)}
            >
              <span aria-hidden className={`wd-swatch wd-swatch-${option}`} />
              {m.gallery[option]}
            </button>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}
