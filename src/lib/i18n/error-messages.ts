import type { FrozenLandingMessages } from "./frozen-landing-en";
import type { Locale } from "./locale";

type ErrorMessages = FrozenLandingMessages["errors"];

/** Small synchronous catalog for failures that happen before a route can load. */
export const ERROR_MESSAGES = {
  en: {
    notFoundHeading: "Page not found",
    notFoundBody: "The page you're looking for doesn't exist or has been moved.",
    goHome: "Go home",
    errorTitle: "This page didn't load",
    errorBody: "Something went wrong on our end. You can try refreshing or head back home.",
    tryAgain: "Try again",
  },
  ko: {
    notFoundHeading: "페이지를 찾을 수 없습니다",
    notFoundBody: "찾으시는 페이지가 없거나 이동되었습니다.",
    goHome: "홈으로",
    errorTitle: "페이지를 불러오지 못했습니다",
    errorBody: "저희 쪽 문제입니다. 새로고침하거나 홈으로 돌아가 보세요.",
    tryAgain: "다시 시도",
  },
  "zh-CN": {
    notFoundHeading: "找不到页面",
    notFoundBody: "你要找的页面不存在或已被移动。",
    goHome: "返回首页",
    errorTitle: "页面加载失败",
    errorBody: "是我们这边出了问题。你可以刷新重试，或返回首页。",
    tryAgain: "重试",
  },
  "zh-TW": {
    notFoundHeading: "找不到頁面",
    notFoundBody: "你要找的頁面不存在或已被移動。",
    goHome: "回到首頁",
    errorTitle: "頁面載入失敗",
    errorBody: "是我們這邊出了問題。你可以重新整理，或回到首頁。",
    tryAgain: "再試一次",
  },
  ja: {
    notFoundHeading: "ページが見つかりません",
    notFoundBody: "お探しのページは存在しないか、移動しました。",
    goHome: "ホームへ",
    errorTitle: "ページを読み込めませんでした",
    errorBody: "こちら側の問題です。再読み込みするか、ホームに戻ってください。",
    tryAgain: "もう一度試す",
  },
  es: {
    notFoundHeading: "Página no encontrada",
    notFoundBody: "La página que buscas no existe o se ha movido.",
    goHome: "Ir al inicio",
    errorTitle: "Esta página no cargó",
    errorBody: "Algo salió mal de nuestro lado. Puedes actualizar o volver al inicio.",
    tryAgain: "Reintentar",
  },
  fr: {
    notFoundHeading: "Page introuvable",
    notFoundBody: "La page que vous cherchez n'existe pas ou a été déplacée.",
    goHome: "Retour à l'accueil",
    errorTitle: "Cette page n'a pas chargé",
    errorBody: "Un problème est survenu de notre côté. Actualisez la page ou revenez à l'accueil.",
    tryAgain: "Réessayer",
  },
  de: {
    notFoundHeading: "Seite nicht gefunden",
    notFoundBody: "Die gesuchte Seite existiert nicht oder wurde verschoben.",
    goHome: "Zur Startseite",
    errorTitle: "Diese Seite hat nicht geladen",
    errorBody: "Bei uns ist etwas schiefgelaufen. Lade neu oder geh zurück zur Startseite.",
    tryAgain: "Erneut versuchen",
  },
  "pt-BR": {
    notFoundHeading: "Página não encontrada",
    notFoundBody: "A página que você procura não existe ou foi movida.",
    goHome: "Ir para o início",
    errorTitle: "Esta página não carregou",
    errorBody: "Algo deu errado do nosso lado. Você pode atualizar ou voltar ao início.",
    tryAgain: "Tentar de novo",
  },
} as const satisfies Record<Locale, ErrorMessages>;
