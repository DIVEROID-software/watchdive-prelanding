import { writeFileSync } from 'node:fs';
import { buddyGuideBody, referralNoticeBody } from '../src/lib/verification/resend.ts';
const out: Record<string, unknown> = {};
for (const locale of ['ko', 'en'] as const) {
  const origin = 'https://watchdive.example';
  const prefix = locale === 'en' ? '' : '/ko';
  const footer = { korean: locale === 'ko', unsubscribeUrl: `${origin}/unsubscribe/u1.example-${locale}`, senderPhone: '+82 2-0000-0000' };
  const links = { shareUrl: `${origin}/r/abc12345`, statusUrl: `${origin}${prefix}/buddy#abc12345.1.EXAMPLE`, rulesUrl: `${origin}${prefix}/buddy-rules` };
  const guide = buddyGuideBody(links, locale, footer, 'JEJUBUDDY');
  out[`guide-${locale}`] = guide;
  writeFileSync(`qa/guide-${locale}.html`, guide.html);
  writeFileSync(`qa/guide-${locale}.txt`, guide.text);
  for (const credited of [3,10]) {
    const mail = referralNoticeBody({ locale, credited, crossed: credited === 3 ? ['buddy'] : ['team','leader'], nextTier: credited === 3 ? 'team' : null, remainingToNext: credited === 3 ? 2 : null, statusUrl: links.statusUrl }, footer);
    writeFileSync(`qa/notice-${locale}-${credited}.html`, mail.html);
    writeFileSync(`qa/notice-${locale}-${credited}.txt`, mail.text);
    if (credited === (locale === 'ko' ? 3 : 10)) out[`notice-${locale}`] = mail;
  }
}
writeFileSync('qa/mails.json', JSON.stringify(out, null, 2));
