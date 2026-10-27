// Shared WatchDive mail chrome. Table layout and inline styles only.
// The logo file is the official primary PNG: cyan #36A9E1 fill, black #000000
// outline. Do not redraw it, recolor it, or add a shadow to the image.

export const WATCHDIVE_MAIL_LOGO_URL =
  "https://hub.diveroid.ai/brand-system/communication/assets/product-wordmarks/watchdive-primary@1x.png?v=2.6.1";
export const WATCHDIVE_MAIL_LOGO_PATH = "/brand/mail/watchdive-primary.png";
/** Display width. 237 / 35 matches the 1200×177 PNG within a fraction of a percent. */
export const WATCHDIVE_MAIL_LOGO_WIDTH = 237;
export const WATCHDIVE_MAIL_LOGO_HEIGHT = 35;
export const WATCHDIVE_MAIL_LOGO_ALT = "WatchDive";

export const MAIL_INK = "#111111";
export const MAIL_TEXT = "#1a1238";
export const MAIL_VIOLET = "#201748";
export const MAIL_MID = "#3D2683";
export const MAIL_CYAN = "#36A9E1";
export const MAIL_YELLOW = "#ffe55c";
export const MAIL_FOAM = "#EEF9FF";
export const MAIL_CANVAS = "#F6FAFC";
export const MAIL_PAPER = "#ffffff";
export const MAIL_PAGE = "#f5f3ee";
export const MAIL_MUTED = "#534e63";
export const MAIL_FONT =
  "Arial,'Helvetica Neue','Apple SD Gothic Neo','Malgun Gothic','Hiragino Sans','Microsoft YaHei','PingFang SC','PingFang TC',sans-serif";

export function watchdiveLogoImg(src: string = WATCHDIVE_MAIL_LOGO_URL): string {
  const safe = src.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return (
    `<img src="${safe}" width="${WATCHDIVE_MAIL_LOGO_WIDTH}" height="${WATCHDIVE_MAIL_LOGO_HEIGHT}" ` +
    `alt="${WATCHDIVE_MAIL_LOGO_ALT}" style="display:block;width:${WATCHDIVE_MAIL_LOGO_WIDTH}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`
  );
}
