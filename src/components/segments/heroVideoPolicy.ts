/** When the hero file may exist in the DOM, and when it may actually play.
 * Automatic play is a wide, unconstrained screen. An explicit play mounts the
 * file at any width, including a constrained connection or reduced motion.
 * Offscreen, a hidden tab, and the pause control stop playback either way.
 */

export const HERO_AUTOPLAY_MEDIA = "(min-width: 960px)";

export type HeroVideoGate = {
  ready: boolean;
  failed: boolean;
  lite: boolean;
  reducedMotion: boolean;
  wide: boolean;
  requested: boolean;
};

export function heroVideoAllowed(input: HeroVideoGate): boolean {
  if (!input.ready || input.failed) return false;
  if (input.requested) return true;
  return input.wide && !input.lite && !input.reducedMotion;
}

export function heroVideoShouldPlay(input: HeroVideoGate & {
  inView: boolean;
  tabVisible: boolean;
  paused: boolean;
}): boolean {
  return heroVideoAllowed(input) && input.inView && input.tabVisible && !input.paused;
}
