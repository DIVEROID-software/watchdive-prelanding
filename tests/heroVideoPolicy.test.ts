/** Hero file eligibility. No browser and no video bytes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HERO_AUTOPLAY_MEDIA, heroVideoAllowed, heroVideoShouldPlay, type HeroVideoGate } from "../src/components/segments/heroVideoPolicy.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const open: HeroVideoGate = {
  ready: true,
  failed: false,
  lite: false,
  reducedMotion: false,
  wide: true,
  requested: false,
};

test("automatic hero playback is wide, unconstrained, and in view", () => {
  assert.equal(HERO_AUTOPLAY_MEDIA, "(min-width: 960px)");
  assert.equal(heroVideoAllowed(open), true);
  assert.equal(heroVideoAllowed({ ...open, wide: false }), false);
  assert.equal(heroVideoAllowed({ ...open, lite: true }), false);
  assert.equal(heroVideoAllowed({ ...open, reducedMotion: true }), false);
  assert.equal(heroVideoAllowed({ ...open, ready: false }), false);
  assert.equal(heroVideoAllowed({ ...open, failed: true }), false);
  assert.equal(heroVideoShouldPlay({ ...open, inView: true, tabVisible: true, paused: false }), true);
  assert.equal(heroVideoShouldPlay({ ...open, inView: false, tabVisible: true, paused: false }), false);
  assert.equal(heroVideoShouldPlay({ ...open, inView: true, tabVisible: false, paused: false }), false);
  assert.equal(heroVideoShouldPlay({ ...open, inView: true, tabVisible: true, paused: true }), false);
});

test("an explicit play mounts the file at any width, including lite and reduced motion", () => {
  for (const patch of [
    { wide: false },
    { lite: true },
    { reducedMotion: true },
    { wide: false, lite: true, reducedMotion: true },
  ]) {
    const gate = { ...open, ...patch, requested: true };
    assert.equal(heroVideoAllowed(gate), true, JSON.stringify(patch));
    assert.equal(heroVideoShouldPlay({ ...gate, inView: true, tabVisible: true, paused: false }), true);
    assert.equal(heroVideoShouldPlay({ ...gate, inView: false, tabVisible: true, paused: false }), false);
  }
  assert.equal(heroVideoAllowed({ ...open, wide: false, requested: false }), false);
});

test("the hero source keeps the poster eager and the file off the first render", () => {
  const source = read("src/components/segments/SegmentHeroMedia.tsx");
  assert.match(source, /fetchPriority="high" loading="eager"/);
  assert.match(source, /preload="none"/);
  assert.match(source, /useState\(false\)/);
  assert.match(source, /HERO_AUTOPLAY_MEDIA/);
  assert.match(source, /\{allowed && <video/);
  assert.equal(source.includes("react-dom"), false);
  assert.equal(/preload\(/.test(source), false);
  const policy = read("src/components/segments/heroVideoPolicy.ts");
  assert.equal(/\.mp4|preload\(/.test(policy), false);
});
