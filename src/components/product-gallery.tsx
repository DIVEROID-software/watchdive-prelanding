import { useState } from "react";
import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import { useLiteMedia } from "@/lib/liteMedia";
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

/**
 * The whole housing in either finish, contained rather than cropped. It sits in
 * the "This launch" compatibility card, well below the first screen, so it
 * loads lazily and, on a constrained connection, only in its smallest cut.
 */
export function ProductGallery({ sizes }: { sizes: string }) {
  const m = useFrozenLandingMessages();
  const lite = useLiteMedia();
  const [color, setColor] = useState<"black" | "white">("black");
  return (
    <figure className="wd-product-gallery">
      <div className="wd-product-stage">
        <img
          src={images[color].src}
          srcSet={lite ? `${images[color].src} 640w` : images[color].srcSet}
          sizes={sizes}
          alt={color === "black" ? m.gallery.blackAlt : m.gallery.whiteAlt}
          width={640}
          height={480}
          loading="lazy"
          decoding="async"
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
