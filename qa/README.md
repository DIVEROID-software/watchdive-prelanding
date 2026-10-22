# Buddy Invite EVENT visual evidence

All addresses, tokens, counts and phone numbers are QA fakes. No mail was sent.
The preview mounts the production `TierList` with fake counts and the production stylesheet; it mounts no API, router or account session.

- `mails.json`: guide-ko, guide-en, notice-ko (3, buddy), notice-en (10, team + leader), with subject/text/html.
- `guide-{ko,en}.html`, `notice-{ko,en}-{3,10}.html`: rendered production mail functions, plus matching plain text.
- `*-{375,600}-{light,dark}.png`: 24 full-page browser screenshots. Dark uses Chromium's emulated `prefers-color-scheme: dark`; this is not an Outlook/Gmail device-lab certification.
- `site-{ko,en}-{3,10}-390{,-open}.png`: 8 production TierList renders with conditions closed/open.
- `review-*.png`: unscaled contact sheets of all screenshots, each visually inspected by the implementing worker.
- `browser-checks.json`: zero horizontal overflow across all 28 viewport/content cases; all four site disclosures opened.
- `contrast-checks.json`: all visible mail text, all 24 mail cases, minimum contrast 5.1057:1; no failures below 4.5:1.
- `npm-test.log`: 1,146 tests; 1,133 pass; exactly 13 known socialAuth failures.
- `build.log`, `tsc.log`: build success and clean TypeScript check after the build.

Reproduce from the worktree root:

```sh
node --experimental-strip-types qa/render-mails.ts
npx vite --config qa/vite.config.ts
# In a second terminal, while the isolated preview is listening on 127.0.0.1:4197:
node qa/capture.mjs
node qa/contrast.mjs
python3 qa/contact-sheets.py
```

The capture scripts use this machine's installed Playwright package and Chromium executable; change those two local paths on another machine. All captured mail/site browser requests are limited to localhost by `capture.mjs`.

Visual iteration: moved full tier paragraphs out of the ladder, then shortened duplicated legal paragraphs while retaining every required condition and the official rules link. Reviewed all 24 mail screenshots and all 8 site screenshots after that change. Numeric hierarchy, short benefit headlines, reached ticks, next-step emphasis, typography, wrapping, footer readability and disclosure behaviour passed visual review. Only the screenshot pairs shown in the files were inspected; real email-client rendering is unverified.
