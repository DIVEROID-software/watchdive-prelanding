import type { Locale } from "../i18n/locale";
type PushCopy = {
  title: string;
  body: string;
  enable: string;
  disable: string;
  enabled: string;
  denied: string;
  failed: string;
  off: string;
  busy: string;
};
export const PUSH_COPY: Record<Locale, PushCopy> = {
  en: {
    title: "Launch alerts on this device",
    body: "Optional browser notifications for the WatchDive launch. You can turn them off here or in browser settings. This does not sign you up by email.",
    enable: "Allow launch notifications",
    disable: "Turn off notifications",
    enabled: "Notifications are enabled on this browser.",
    denied: "Notifications were not allowed. You can change this in browser settings.",
    failed: "Notifications could not be saved. Please try again.",
    off: "Notifications are off on this browser.",
    busy: "Saving…",
  },
  ko: {
    title: "이 기기에서 출시 알림 받기",
    body: "WatchDive 출시 브라우저 알림은 선택 사항입니다. 여기 또는 브라우저 설정에서 끌 수 있습니다. 이메일 신청은 별도입니다.",
    enable: "출시 알림 허용",
    disable: "알림 끄기",
    enabled: "이 브라우저에서 알림이 켜졌습니다.",
    denied: "알림이 허용되지 않았습니다. 브라우저 설정에서 변경할 수 있습니다.",
    failed: "알림 설정을 저장하지 못했습니다. 다시 시도해 주세요.",
    off: "이 브라우저에서 알림이 꺼졌습니다.",
    busy: "저장 중…",
  },
  "zh-CN": {
    title: "在此设备接收发布通知",
    body: "WatchDive 发布浏览器通知为可选项。你可在此处或浏览器设置中关闭。这不会订阅电子邮件。",
    enable: "允许发布通知",
    disable: "关闭通知",
    enabled: "此浏览器已启用通知。",
    denied: "未允许通知。你可以在浏览器设置中更改。",
    failed: "无法保存通知设置，请重试。",
    off: "此浏览器通知已关闭。",
    busy: "正在保存…",
  },
  "zh-TW": {
    title: "在此裝置接收發布通知",
    body: "WatchDive 發布瀏覽器通知為選用項目。你可在此處或瀏覽器設定中關閉。這不會訂閱電子郵件。",
    enable: "允許發布通知",
    disable: "關閉通知",
    enabled: "此瀏覽器已啟用通知。",
    denied: "未允許通知。你可以在瀏覽器設定中更改。",
    failed: "無法儲存通知設定，請重試。",
    off: "此瀏覽器通知已關閉。",
    busy: "儲存中…",
  },
  ja: {
    title: "この端末で発売通知を受け取る",
    body: "WatchDive発売のブラウザー通知は任意です。ここ、またはブラウザーの設定で解除できます。メール登録は行われません。",
    enable: "発売通知を許可する",
    disable: "通知を解除する",
    enabled: "このブラウザーで通知が有効になりました。",
    denied: "通知は許可されていません。ブラウザーの設定で変更できます。",
    failed: "通知設定を保存できませんでした。もう一度お試しください。",
    off: "このブラウザーの通知は無効です。",
    busy: "保存中…",
  },
  es: {
    title: "Avisos de lanzamiento en este dispositivo",
    body: "Notificaciones opcionales del navegador para el lanzamiento de WatchDive. Puedes desactivarlas aquí o en la configuración del navegador. Esto no te suscribe por correo.",
    enable: "Permitir avisos de lanzamiento",
    disable: "Desactivar notificaciones",
    enabled: "Las notificaciones están activadas en este navegador.",
    denied:
      "No se permitieron las notificaciones. Puedes cambiarlo en la configuración del navegador.",
    failed: "No se pudieron guardar las notificaciones. Inténtalo de nuevo.",
    off: "Las notificaciones están desactivadas en este navegador.",
    busy: "Guardando…",
  },
  fr: {
    title: "Alertes de lancement sur cet appareil",
    body: "Notifications facultatives du navigateur pour le lancement de WatchDive. Désactivez-les ici ou dans les paramètres du navigateur. Ceci ne vous inscrit pas par e-mail.",
    enable: "Autoriser les alertes de lancement",
    disable: "Désactiver les notifications",
    enabled: "Les notifications sont activées dans ce navigateur.",
    denied:
      "Les notifications n’ont pas été autorisées. Vous pouvez modifier ce choix dans les paramètres du navigateur.",
    failed: "Impossible d’enregistrer les notifications. Réessayez.",
    off: "Les notifications sont désactivées dans ce navigateur.",
    busy: "Enregistrement…",
  },
  de: {
    title: "Startbenachrichtigungen auf diesem Gerät",
    body: "Optionale Browserbenachrichtigungen zum Start von WatchDive. Du kannst sie hier oder in den Browsereinstellungen ausschalten. Dies ist keine E-Mail-Anmeldung.",
    enable: "Startbenachrichtigungen erlauben",
    disable: "Benachrichtigungen ausschalten",
    enabled: "Benachrichtigungen sind in diesem Browser aktiviert.",
    denied:
      "Benachrichtigungen wurden nicht erlaubt. Du kannst dies in den Browsereinstellungen ändern.",
    failed: "Benachrichtigungen konnten nicht gespeichert werden. Bitte erneut versuchen.",
    off: "Benachrichtigungen sind in diesem Browser ausgeschaltet.",
    busy: "Wird gespeichert…",
  },
  "pt-BR": {
    title: "Avisos de lançamento neste dispositivo",
    body: "Notificações opcionais do navegador para o lançamento do WatchDive. Você pode desativá-las aqui ou nas configurações do navegador. Isso não faz uma inscrição por e-mail.",
    enable: "Permitir avisos de lançamento",
    disable: "Desativar notificações",
    enabled: "As notificações estão ativadas neste navegador.",
    denied:
      "As notificações não foram permitidas. Você pode alterar isso nas configurações do navegador.",
    failed: "Não foi possível salvar as notificações. Tente novamente.",
    off: "As notificações estão desativadas neste navegador.",
    busy: "Salvando…",
  },
  nl: {
    title: "Lanceermeldingen op dit apparaat",
    body: "Optionele browsermeldingen voor de lancering van WatchDive. Je kunt ze hier of in de browserinstellingen uitzetten. Dit meldt je niet aan via e-mail.",
    enable: "Lanceermeldingen toestaan",
    disable: "Meldingen uitzetten",
    enabled: "Meldingen staan aan in deze browser.",
    denied: "Meldingen zijn niet toegestaan. Je kunt dit wijzigen in de browserinstellingen.",
    failed: "Meldingen konden niet worden opgeslagen. Probeer het opnieuw.",
    off: "Meldingen staan uit in deze browser.",
    busy: "Opslaan…",
  },
};
