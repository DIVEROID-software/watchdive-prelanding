import { defineConfig } from "vite";
import referralPreview from "./referral.vite.config";

// Serve-only popup QA. This file refuses to build.
// Chrome keeps a fine pointer when the window is only resized, so mobile scroll
// will not arm. Add ?qaTouch=1 on this server to force the touch fixture.
// Production builds do not define VITE_WD_PREVIEW_CAPTURE, so the same query
// there does not change pointer policy.
//
//   npx vite --config preview/popup.vite.config.ts
//   http://localhost:5208/scuba?qaTouch=1
//   http://localhost:5208/ko/freediving?qaTouch=1
//
// localhost is a different origin from 127.0.0.1 previews, so device signup
// state in localStorage starts empty.

export default defineConfig(async (env) => {
  if (env.command !== "serve")
    throw new Error("This local preview must never be built or deployed.");
  const config = await referralPreview(env);
  return {
    ...config,
    cacheDir: "node_modules/.cache/watchdive-popup-5208",
    define: {
      ...config.define,
      "import.meta.env.VITE_WD_PREVIEW_CAPTURE": JSON.stringify("1"),
    },
    server: { ...config.server, host: "localhost", port: 5208, strictPort: true },
  };
});
