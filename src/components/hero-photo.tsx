import { preload } from "react-dom";

import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import { useLiteMediaHint } from "@/lib/liteMedia";
// The housing on a diver's wrist over a reef (TCF archive, watchdive-image10).
// "wide" is a 3:2 crop around the housing and hand for phones and tablets;
// "tall" is the full 5:6 frame for the desktop column. Lanczos resize, AVIF
// q56 with a WebP q78 fallback. The largest phone cut is 27 KB (AVIF).
import wide480Avif from "@/assets/live/hero/wrist-reef-wide-480.avif";
import wide720Avif from "@/assets/live/hero/wrist-reef-wide-720.avif";
import wide1080Avif from "@/assets/live/hero/wrist-reef-wide-1080.avif";
import wide480Webp from "@/assets/live/hero/wrist-reef-wide-480.webp";
import wide720Webp from "@/assets/live/hero/wrist-reef-wide-720.webp";
import wide1080Webp from "@/assets/live/hero/wrist-reef-wide-1080.webp";
import tall640Avif from "@/assets/live/hero/wrist-reef-tall-640.avif";
import tall960Avif from "@/assets/live/hero/wrist-reef-tall-960.avif";
import tall1280Avif from "@/assets/live/hero/wrist-reef-tall-1280.avif";
import tall640Webp from "@/assets/live/hero/wrist-reef-tall-640.webp";
import tall960Webp from "@/assets/live/hero/wrist-reef-tall-960.webp";
import tall1280Webp from "@/assets/live/hero/wrist-reef-tall-1280.webp";

const DESKTOP = "(min-width: 1024px)";
const MOBILE = "(max-width: 1023px)";
// Full-bleed below 640px, one 600px column to 1023px, the right column above.
const WIDE_SIZES = "(min-width: 640px) 600px, 100vw";
const TALL_SIZES = "(min-width: 1152px) 540px, 46vw";

function cuts(lite: boolean) {
  // With Save-Data only the smallest cut is offered, whatever the screen density.
  return lite
    ? {
        wideAvif: `${wide480Avif} 480w`,
        wideWebp: `${wide480Webp} 480w`,
        tallAvif: `${tall640Avif} 640w`,
        tallWebp: `${tall640Webp} 640w`,
      }
    : {
        wideAvif: `${wide480Avif} 480w, ${wide720Avif} 720w, ${wide1080Avif} 1080w`,
        wideWebp: `${wide480Webp} 480w, ${wide720Webp} 720w, ${wide1080Webp} 1080w`,
        tallAvif: `${tall640Avif} 640w, ${tall960Avif} 960w, ${tall1280Avif} 1280w`,
        tallWebp: `${tall640Webp} 640w, ${tall960Webp} 960w, ${tall1280Webp} 1280w`,
      };
}

/**
 * The first thing an ad visitor sees: the product in use, in water, on a wrist.
 * Until the photo arrives the frame shows a blurred 24px preview inlined in
 * the stylesheet over the photo's average colour, so the hero never paints as
 * an empty box. The box keeps its aspect ratio from CSS, so nothing shifts.
 */
export function HeroPhoto() {
  const m = useFrozenLandingMessages();
  const c = cuts(useLiteMediaHint());
  // React hoists these to the top of <head>, beside its own image preloads and
  // ahead of the stylesheet and scripts, so the photo is among the first
  // requests (a route-level head link landed after the module preloads and
  // waited for a free connection). They mirror the <picture> sources exactly
  // (type, media, srcset, sizes), so the response is reused, not fetched
  // twice. A browser without AVIF skips them and the <picture> picks WebP.
  preload(wide720Avif, {
    as: "image",
    type: "image/avif",
    media: MOBILE,
    imageSrcSet: c.wideAvif,
    imageSizes: WIDE_SIZES,
    fetchPriority: "high",
  });
  preload(tall960Avif, {
    as: "image",
    type: "image/avif",
    media: DESKTOP,
    imageSrcSet: c.tallAvif,
    imageSizes: TALL_SIZES,
    fetchPriority: "high",
  });
  return (
    <figure className="wd-hero-photo">
      <picture>
        <source media={DESKTOP} type="image/avif" srcSet={c.tallAvif} sizes={TALL_SIZES} />
        <source media={DESKTOP} type="image/webp" srcSet={c.tallWebp} sizes={TALL_SIZES} />
        <source type="image/avif" srcSet={c.wideAvif} sizes={WIDE_SIZES} />
        <img
          src={wide720Webp}
          srcSet={c.wideWebp}
          sizes={WIDE_SIZES}
          alt={m.hero.sideImageAlt}
          width={1080}
          height={720}
          loading="eager"
          fetchPriority="high"
        />
      </picture>
    </figure>
  );
}
