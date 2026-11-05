/** Comparison isolation. Pins real approved sources, not copied snapshots of output. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (name: string) => readFileSync(new URL(`../src/components/segments/${name}`, import.meta.url), "utf8");
const sha = (source: string) => createHash("sha256").update(source).digest("hex");
const production126bb825 = {
  "SegmentLanding.tsx": "726f3a63c3fb46f801aafa729a34491562cbc3564b607328cc96596af877919a",
  "SegmentHeroMedia.tsx": "69fb89326a2b1e9d92efea32b16c82df6376b580aeef9e4444cae5351b7a056b",
  "SegmentHeroJump.tsx": "cff160d25c03f20ebe63571fa05e7fcc204fe501e320be6cdc9c5178242271fe",
  "heroVideoPolicy.ts": "62a9e7a438e16e143630cbfd29ce616aa05cd50325176a00346bf46ac16af0b7"
};

test("control landing, jump and mobile hero are production 126bb825 with isolated import paths only", () => {
  const landing = read("SegmentLanding.tsx").replace("from './ControlHeroMedia'", "from './SegmentHeroMedia'").replace("from './ControlHeroJump'", "from './SegmentHeroJump'");
  assert.equal(sha(landing), production126bb825["SegmentLanding.tsx"]);
  assert.equal(sha(read("ControlHeroMedia.tsx").replace("from './controlHeroVideoPolicy'", "from './heroVideoPolicy'")), production126bb825["SegmentHeroMedia.tsx"]);
  assert.equal(sha(read("ControlHeroJump.tsx")), production126bb825["SegmentHeroJump.tsx"]);
  assert.equal(sha(read("controlHeroVideoPolicy.ts")), production126bb825["heroVideoPolicy.ts"]);
  assert.match(landing, /<AcquisitionTools compatibility=\{false\} \/>/);
  assert.doesNotMatch(landing, /capture="none"|socialAfterEmail|wd-segment-airy|airy\.css/);
});

test("launch design remains approved 5470cbc except its exported name and variant mode links", () => {
  const airy = read("AirySegmentLanding.tsx")
    .replace("export function AirySegmentLanding(", "export function SegmentLanding(")
    .replace("localizePath(`/launch/${mode}`, locale)", "localizePath(`/${mode}`, locale)")
    .replace("localizePath(`/launch/${alternate}`, locale)", "localizePath(`/${alternate}`, locale)");
  assert.equal(sha(airy), "f1d70e250df54393eb2e376b612db4e70f3a1e7e5f9292e94b7674128580dc17");
});
