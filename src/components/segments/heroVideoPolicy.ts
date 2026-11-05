/** When the hero file may exist in the DOM, and when it may actually play.
 * Automatic play works at every width on an unconstrained connection when
 * motion is allowed. Explicit play also permits constrained/reduced-motion use.
 * Offscreen, a hidden tab, and the pause control stop playback either way.
 */

export type HeroVideoGate = {
  ready: boolean;
  failed: boolean;
  lite: boolean;
  reducedMotion: boolean;
  requested: boolean;
};

export function heroVideoAllowed(input: HeroVideoGate): boolean {
  if (!input.ready || input.failed) return false;
  if (input.requested) return true;
  return !input.lite && !input.reducedMotion;
}

export function heroVideoShouldPlay(input: HeroVideoGate & {
  inView: boolean;
  tabVisible: boolean;
  paused: boolean;
}): boolean {
  return heroVideoAllowed(input) && input.inView && input.tabVisible && !input.paused;
}
