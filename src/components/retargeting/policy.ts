export type CaptureFacts = {
  knownSignup: boolean;
  paid: boolean;
  seen: boolean;
  dismissed: boolean;
  activeForm: boolean;
  dialog: boolean;
  playingVideo: boolean;
  fullscreen: boolean;
  hidden: boolean;
};
export type CaptureTrigger =
  | { kind: "desktop-exit"; finePointer: boolean; clientY: number; relatedTarget: boolean }
  | { kind: "mobile-scroll"; finePointer: boolean; progress: number };
export function shouldOpenCapture(facts: CaptureFacts, trigger: CaptureTrigger): boolean {
  if (Object.values(facts).some(Boolean)) return false;
  return trigger.kind === "desktop-exit"
    ? trigger.finePointer && trigger.clientY <= 0 && !trigger.relatedTarget
    : !trigger.finePointer && trigger.progress >= 0.5;
}
export const CAPTURE_SESSION_KEY = "wd:acquisition-capture:v1";
export function scrollProgress(scrollY: number, documentHeight: number, viewportHeight: number) {
  const available = documentHeight - viewportHeight;
  return available > 0 ? Math.min(1, Math.max(0, scrollY / available)) : 0;
}
export function videoBlocksCapture(video: {
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  controls: boolean;
  userPlaying: boolean;
  visible: boolean;
}): boolean {
  if (video.paused || video.ended) return false;
  // Audible playback remains active even offscreen; silent ambient hero loops
  // are decoration. Visible controls/explicit user playback must not be interrupted.
  return (
    (!video.muted && video.volume > 0) || (video.visible && (video.controls || video.userPlaying))
  );
}
export function hasCaptureInterruption(document: Document): boolean {
  const active = document.activeElement;
  return Boolean(
    document.fullscreenElement ||
    document.hidden ||
    active?.closest('form,input,textarea,select,[contenteditable="true"],[role="textbox"]') ||
    document.querySelector(
      'dialog[open],[role="dialog"][aria-modal="true"], [data-wd-capture-block]',
    ) ||
    [...document.querySelectorAll("video")].some((video) => {
      if (video.paused || video.ended) return false;
      const rect = video.getBoundingClientRect();
      const height =
        document.defaultView?.innerHeight ?? document.documentElement?.clientHeight ?? 0;
      const width = document.defaultView?.innerWidth ?? document.documentElement?.clientWidth ?? 0;
      return videoBlocksCapture({
        paused: video.paused,
        ended: video.ended,
        muted: video.muted,
        volume: video.volume,
        controls: video.controls,
        userPlaying: video.hasAttribute("data-wd-user-playing"),
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < height &&
          rect.left < width,
      });
    }),
  );
}
