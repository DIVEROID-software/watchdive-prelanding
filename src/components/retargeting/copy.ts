import type { Locale } from "../../lib/i18n/locale";
type Copy = {
  exitTitle: string;
  exitCta: string;
  exitBody: string;
  decline: string;
  close: string;
  checkerTitle: string;
  checkerBody: string;
  model: string;
  choose: string;
  otherApple: string;
  other: string;
  request: string;
  listed: string;
  planned: string;
  unconfirmed: string;
  verify: string;
  sizes: string;
};
export const RETARGETING_COPY: Record<Locale, Copy> = {
  en: {
    exitCta: "Get launch updates",
    exitTitle: "Keep WatchDive on your radar.",
    exitBody: "Get the launch email. Confirm your address using the link we send.",
    decline: "No thanks",
    close: "Close",
    checkerTitle: "Will WatchDive work with your watch?",
    checkerBody:
      "Choose your model and request the current compatibility result by email. The same email lets you confirm your launch signup.",
    model: "Watch model",
    choose: "Choose your model",
    otherApple: "Apple Watch (except Ultra, Ultra 2 and Ultra 3)",
    other: "My model is not listed",
    request: "Email my result",
    listed:
      "Listed for the housing + app launch. Final compatibility remains subject to the launch list.",
    planned:
      "App-only support is planned. This model is not included in the housing + app launch list.",
    unconfirmed: "We cannot confirm support for this model yet.",
    verify:
      "Your email address is not verified yet. Use the confirmation link in this email to complete verification.",
    sizes: "Select your watch model to check support.",
  },
  ko: {
    exitCta: "출시 알림 받기",
    exitTitle: "WatchDive 출시 소식을 받아보세요.",
    exitBody: "출시 알림 이메일을 신청하고, 보내드린 링크로 이메일을 확인해 주세요.",
    decline: "괜찮아요",
    close: "닫기",
    checkerTitle: "내 워치도 WatchDive와 호환될까요?",
    checkerBody:
      "모델을 선택하고 현재 호환 결과를 이메일로 받아보세요. 같은 이메일에서 출시 알림 신청을 인증할 수 있어요.",
    model: "워치 모델",
    choose: "모델 선택",
    otherApple: "Apple Watch (Ultra, Ultra 2, Ultra 3 제외)",
    other: "목록에 없는 모델",
    request: "이메일로 결과 받기",
    listed: "하우징 + 앱 출시 대상 목록에 있습니다. 최종 호환 여부는 출시 목록에서 확인해 주세요.",
    planned: "앱 전용 지원을 준비 중입니다. 하우징 + 앱 출시 대상 목록에는 포함되지 않습니다.",
    unconfirmed: "이 모델의 지원 여부는 아직 확인되지 않았습니다.",
    verify: "이메일 인증이 아직 완료되지 않았습니다. 이 이메일의 확인 링크를 눌러 인증해 주세요.",
    sizes: "사용 중인 워치 모델을 선택해 주세요.",
  },
  "zh-CN": {
    exitCta: "获取发布通知",
    exitTitle: "关注 WatchDive 发布消息。",
    exitBody: "订阅发布邮件，并通过收到的链接验证邮箱。",
    decline: "暂时不用",
    close: "关闭",
    checkerTitle: "WatchDive 支持你的手表吗？",
    checkerBody: "选择型号，通过邮件获取当前兼容性结果。同一封邮件也可验证发布订阅。",
    model: "手表型号",
    choose: "选择型号",
    otherApple: "Apple Watch（Ultra、Ultra 2 和 Ultra 3 除外）",
    other: "我的型号不在列表中",
    request: "通过邮件获取结果",
    listed: "已列入外壳 + 应用发布名单。最终兼容性以发布名单为准。",
    planned: "仅应用支持仍在规划中。此型号不在外壳 + 应用发布名单中。",
    unconfirmed: "我们尚无法确认是否支持此型号。",
    verify: "你的邮箱尚未验证。请使用此邮件中的确认链接完成验证。",
    sizes: "请选择你的手表型号以查看支持情况。",
  },
  "zh-TW": {
    exitCta: "接收發布通知",
    exitTitle: "掌握 WatchDive 發布消息。",
    exitBody: "訂閱發布郵件，並透過收到的連結驗證信箱。",
    decline: "暫時不用",
    close: "關閉",
    checkerTitle: "WatchDive 支援你的手錶嗎？",
    checkerBody: "選擇型號，透過電子郵件取得目前的相容性結果。同一封郵件也可驗證發布訂閱。",
    model: "手錶型號",
    choose: "選擇型號",
    otherApple: "Apple Watch（Ultra、Ultra 2 和 Ultra 3 除外）",
    other: "我的型號不在清單中",
    request: "寄送結果給我",
    listed: "已列入外殼 + 應用程式發布清單。最終相容性以發布清單為準。",
    planned: "僅應用程式支援仍在規劃中。此型號不在外殼 + 應用程式發布清單中。",
    unconfirmed: "我們尚無法確認是否支援此型號。",
    verify: "你的信箱尚未驗證。請使用此郵件中的確認連結完成驗證。",
    sizes: "請選擇你的手錶型號以查看支援情況。",
  },
  ja: {
    exitCta: "発売通知を受け取る",
    exitTitle: "WatchDiveの発売情報をお届けします。",
    exitBody: "発売通知メールに申し込み、届いたリンクでメールアドレスを確認してください。",
    decline: "今は登録しない",
    close: "閉じる",
    checkerTitle: "お使いのウォッチに対応していますか？",
    checkerBody:
      "モデルを選び、現在の対応状況をメールで受け取れます。同じメールから発売通知の登録認証ができます。",
    model: "ウォッチのモデル",
    choose: "モデルを選択",
    otherApple: "Apple Watch（Ultra、Ultra 2、Ultra 3を除く）",
    other: "一覧にないモデル",
    request: "結果をメールで受け取る",
    listed:
      "ハウジング＋アプリの発売対象一覧に掲載されています。最終的な対応状況は発売時の一覧をご確認ください。",
    planned: "アプリ単独の対応を予定しています。ハウジング＋アプリの発売対象一覧には含まれません。",
    unconfirmed: "このモデルの対応状況はまだ確認できていません。",
    verify:
      "メールアドレスはまだ認証されていません。このメールの確認リンクで認証を完了してください。",
    sizes: "お使いのウォッチを選んで対応状況をご確認ください。",
  },
  es: {
    exitCta: "Recibir el aviso de lanzamiento",
    exitTitle: "Sigue las novedades de WatchDive.",
    exitBody:
      "Recibe el aviso de lanzamiento y confirma tu correo con el enlace que te enviaremos.",
    decline: "No, gracias",
    close: "Cerrar",
    checkerTitle: "¿WatchDive funciona con tu reloj?",
    checkerBody:
      "Elige tu modelo y recibe el resultado de compatibilidad por correo. Ese mismo mensaje te permite confirmar tu suscripción al lanzamiento.",
    model: "Modelo de reloj",
    choose: "Elige un modelo",
    otherApple: "Apple Watch (excepto Ultra, Ultra 2 y Ultra 3)",
    other: "Mi modelo no aparece",
    request: "Recibir el resultado por correo",
    listed:
      "Incluido en la lista de lanzamiento de carcasa + app. La compatibilidad definitiva depende de la lista de lanzamiento.",
    planned:
      "El soporte solo con la app está previsto. Este modelo no está incluido en la lista de lanzamiento de carcasa + app.",
    unconfirmed: "Aún no podemos confirmar la compatibilidad de este modelo.",
    verify:
      "Tu correo aún no está verificado. Usa el enlace de confirmación de este mensaje para verificarlo.",
    sizes: "Selecciona tu modelo de reloj para comprobar la compatibilidad.",
  },
  fr: {
    exitCta: "Recevoir l’alerte de lancement",
    exitTitle: "Gardez un œil sur WatchDive.",
    exitBody: "Recevez le message de lancement et confirmez votre adresse avec le lien envoyé.",
    decline: "Non merci",
    close: "Fermer",
    checkerTitle: "WatchDive est-il compatible avec votre montre ?",
    checkerBody:
      "Choisissez votre modèle et recevez le résultat actuel par e-mail. Ce même message permet de confirmer votre inscription au lancement.",
    model: "Modèle de montre",
    choose: "Choisir un modèle",
    otherApple: "Apple Watch (sauf Ultra, Ultra 2 et Ultra 3)",
    other: "Mon modèle ne figure pas dans la liste",
    request: "Recevoir le résultat par e-mail",
    listed:
      "Répertorié pour le lancement boîtier + application. La compatibilité définitive dépend de la liste au lancement.",
    planned:
      "La prise en charge par application seule est prévue. Ce modèle ne figure pas dans la liste du lancement boîtier + application.",
    unconfirmed: "Nous ne pouvons pas encore confirmer la prise en charge de ce modèle.",
    verify:
      "Votre adresse e-mail n’est pas encore vérifiée. Utilisez le lien de confirmation de ce message.",
    sizes: "Sélectionnez votre modèle de montre pour vérifier sa compatibilité.",
  },
  de: {
    exitCta: "Startbenachrichtigung erhalten",
    exitTitle: "Behalte WatchDive im Blick.",
    exitBody: "Erhalte die E-Mail zum Start und bestätige deine Adresse über den zugesandten Link.",
    decline: "Nein danke",
    close: "Schließen",
    checkerTitle: "Funktioniert WatchDive mit deiner Uhr?",
    checkerBody:
      "Wähle dein Modell und erhalte das aktuelle Kompatibilitätsergebnis per E-Mail. Mit derselben Nachricht bestätigst du deine Anmeldung zum Start.",
    model: "Uhrenmodell",
    choose: "Modell auswählen",
    otherApple: "Apple Watch (außer Ultra, Ultra 2 und Ultra 3)",
    other: "Mein Modell ist nicht aufgeführt",
    request: "Ergebnis per E-Mail erhalten",
    listed:
      "Für den Start mit Gehäuse + App aufgeführt. Die endgültige Kompatibilität richtet sich nach der Liste zum Start.",
    planned:
      "Die Unterstützung nur per App ist geplant. Dieses Modell gehört nicht zur Startliste für Gehäuse + App.",
    unconfirmed: "Die Unterstützung für dieses Modell ist noch nicht bestätigt.",
    verify:
      "Deine E-Mail-Adresse ist noch nicht bestätigt. Verwende den Bestätigungslink in dieser Nachricht.",
    sizes: "Wähle dein Uhrenmodell, um die Unterstützung zu prüfen.",
  },
  "pt-BR": {
    exitCta: "Receber o aviso de lançamento",
    exitTitle: "Acompanhe o WatchDive.",
    exitBody: "Receba o aviso de lançamento e confirme seu e-mail pelo link enviado.",
    decline: "Não, obrigado",
    close: "Fechar",
    checkerTitle: "O WatchDive funciona com seu relógio?",
    checkerBody:
      "Escolha seu modelo e receba o resultado atual por e-mail. A mesma mensagem permite confirmar sua inscrição para o lançamento.",
    model: "Modelo do relógio",
    choose: "Escolha o modelo",
    otherApple: "Apple Watch (exceto Ultra, Ultra 2 e Ultra 3)",
    other: "Meu modelo não está na lista",
    request: "Receber o resultado por e-mail",
    listed:
      "Listado para o lançamento de caixa + app. A compatibilidade final depende da lista de lançamento.",
    planned:
      "O suporte somente pelo app está planejado. Este modelo não está na lista de lançamento de caixa + app.",
    unconfirmed: "Ainda não podemos confirmar o suporte para este modelo.",
    verify: "Seu e-mail ainda não foi verificado. Use o link de confirmação nesta mensagem.",
    sizes: "Selecione seu modelo de relógio para verificar o suporte.",
  },
};
