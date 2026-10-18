import { preload } from "react-dom";
import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import { useLiteMediaHint } from "@/lib/liteMedia";
// Pool photograph: TCF / 07_USE CASE | DEEP DIVING / 2_DEEPDIVING.jpeg.
// Source EXIF: Canon EOS R5 C, Mangrove Inc., copyright YONGSOO SHIN.
// Existing resize/crop derivatives only; no generated or composited background.
import wide from "@/assets/live/refresh/underwater-1600.webp";
import tall640 from "@/assets/live/refresh/underwater-mobile-640.webp";
import tall1000 from "@/assets/live/refresh/underwater-mobile-1000.webp";

export function HeroPhoto() {
  const m = useFrozenLandingMessages();
  const lite = useLiteMediaHint();
  const tallSet = lite ? `${tall640} 640w` : `${tall640} 640w, ${tall1000} 1000w`;
  const mobile = lite ? tall640 : wide;
  preload(mobile, { as: "image", type: "image/webp", media: "(max-width: 1023px)", fetchPriority: "high" });
  preload(tall640, { as: "image", type: "image/webp", media: "(min-width: 1024px)", imageSrcSet: tallSet, imageSizes: "(min-width: 1152px) 540px, 46vw", fetchPriority: "high" });
  return (
    <figure className="wd-hero-photo">
      <picture>
        <source media="(min-width: 1024px)" type="image/webp" srcSet={tallSet} sizes="(min-width: 1152px) 540px, 46vw" />
        <img src={mobile} alt={m.hero.sideImageAlt} width={1600} height={1067} loading="eager" fetchPriority="high" />
      </picture>
    </figure>
  );
}
