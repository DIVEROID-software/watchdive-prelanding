/* No fetch interception, caching, analytics, automatic subscribe, or sender.
 * Subscription uses isolated /watchdive-push/ scope. Draft copy requires owner
 * approval (wd-push-launch-v1) before server config can enable opt-in. */
const launchCopy = {
  en: "WatchDive launch news is available. Open the site for details.",
  ko: "WatchDive 출시 소식이 있습니다. 사이트에서 자세히 확인하세요.",
  "zh-CN": "WatchDive 发布消息已更新。打开网站查看详情。",
  "zh-TW": "WatchDive 發布消息已更新。開啟網站查看詳情。",
  ja: "WatchDiveの発売情報が届きました。詳細はサイトをご覧ください。",
  es: "Hay novedades sobre el lanzamiento de WatchDive. Abre el sitio para más información.",
  fr: "Des nouvelles du lancement de WatchDive sont disponibles. Consultez le site.",
  de: "Es gibt Neuigkeiten zum Start von WatchDive. Öffne die Website für Details.",
  "pt-BR": "Há novidades sobre o lançamento do WatchDive. Abra o site para saber mais.",
  nl: "Er is nieuws over de lancering van WatchDive. Open de site voor de details.",
};
const paths = {
  en: "/",
  ko: "/ko",
  "zh-CN": "/zh-cn",
  "zh-TW": "/zh-tw",
  ja: "/ja",
  es: "/es",
  fr: "/fr",
  de: "/de",
  "pt-BR": "/pt-br",
  nl: "/nl",
};
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (
    !payload ||
    payload.copyVersion !== "wd-push-launch-v1" ||
    payload.kind !== "launch" ||
    !Object.hasOwn(launchCopy, payload.locale)
  )
    return;
  // Payload cannot inject text, arbitrary URLs, urgency or customer data.
  event.waitUntil(
    self.registration.showNotification("WatchDive", {
      body: launchCopy[payload.locale],
      lang: payload.locale,
      tag: "watchdive-launch",
      data: { path: paths[payload.locale] },
      requireInteraction: false,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path;
  const safePath = Object.values(paths).includes(path) ? path : "/";
  const target = new URL(safePath, self.location.origin).href;
  event.waitUntil(self.clients.openWindow(target));
});
