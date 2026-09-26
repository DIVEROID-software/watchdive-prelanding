import type { FrozenLandingMessages } from "./frozen-landing-en";
import type { Locale } from "./locale";

type ErrorMessages = FrozenLandingMessages["errors"];

/** Small synchronous catalog for failures that happen before a route can load. */
export const ERROR_MESSAGES = {
  en: {
    notFoundHeading: "Page not found",
    notFoundBody: "The page you're looking for doesn't exist or has moved.",
    goHome: "Go home",
    errorTitle: "This page didn't load",
    errorBody: "Something went wrong on our end. Try refreshing, or head back home.",
    tryAgain: "Try again",
  },
  ko: {
    notFoundHeading: "페이지를 찾을 수 없습니다",
    notFoundBody: "찾으시는 페이지가 없거나 자리를 옮겼습니다.",
    goHome: "홈으로",
    errorTitle: "페이지를 불러오지 못했습니다",
    errorBody: "저희 쪽 문제입니다. 새로고침하거나 홈으로 돌아가 주세요.",
    tryAgain: "다시 시도",
  },
  "zh-CN": {
    notFoundHeading: "找不到页面",
    notFoundBody: "你要找的页面不存在，或者已经移走了。",
    goHome: "返回首页",
    errorTitle: "页面没能加载",
    errorBody: "是我们这边出了问题。可以刷新，或者回到首页。",
    tryAgain: "再试一次",
  },
  "zh-TW": {
    notFoundHeading: "找不到頁面",
    notFoundBody: "你要找的頁面不存在，或者已經搬走了。",
    goHome: "回到首頁",
    errorTitle: "頁面沒能載入",
    errorBody: "是我們這邊出了問題。可以重新整理，或回到首頁。",
    tryAgain: "再試一次",
  },
  ja: {
    notFoundHeading: "ページが見つかりません",
    notFoundBody: "お探しのページは存在しないか、移動しました。",
    goHome: "ホームへ",
    errorTitle: "ページを読み込めませんでした",
    errorBody: "こちら側で問題が起きました。再読み込みするか、ホームに戻ってください。",
    tryAgain: "もう一度",
  },
  es: {
    notFoundHeading: "Página no encontrada",
    notFoundBody: "La página que buscas no existe o se ha movido.",
    goHome: "Ir al inicio",
    errorTitle: "Esta página no se ha cargado",
    errorBody: "Ha fallado algo de nuestro lado. Puedes actualizar o volver al inicio.",
    tryAgain: "Reintentar",
  },
  fr: {
    notFoundHeading: "Page introuvable",
    notFoundBody: "La page que vous cherchez n’existe pas ou a été déplacée.",
    goHome: "Retour à l’accueil",
    errorTitle: "Cette page ne s’est pas chargée",
    errorBody: "Un problème est survenu de notre côté. Actualisez la page ou revenez à l’accueil.",
    tryAgain: "Réessayer",
  },
  de: {
    notFoundHeading: "Seite nicht gefunden",
    notFoundBody: "Die gesuchte Seite gibt es nicht oder sie wurde verschoben.",
    goHome: "Zur Startseite",
    errorTitle: "Diese Seite konnte nicht geladen werden",
    errorBody: "Bei uns ist etwas schiefgelaufen. Lade neu oder geh zurück zur Startseite.",
    tryAgain: "Erneut versuchen",
  },
  "pt-BR": {
    notFoundHeading: "Página não encontrada",
    notFoundBody: "A página que você procura não existe ou foi movida.",
    goHome: "Ir para o início",
    errorTitle: "Não foi possível carregar esta página",
    errorBody: "Deu algo errado do nosso lado. Você pode atualizar ou voltar ao início.",
    tryAgain: "Tentar de novo",
  },
} as const satisfies Record<Locale, ErrorMessages>;
