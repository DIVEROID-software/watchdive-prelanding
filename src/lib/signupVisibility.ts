/** Both actions must fit the visual viewport and be unobscured by consent or
 * sticky overlays. Seeing just the form introduction is not a form exposure. */
export function signupActionsVisible(form: Element): boolean {
  const input = form.querySelector<HTMLInputElement>('input[type="email"]');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input || !button) return false;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const width = window.visualViewport?.width ?? window.innerWidth;
  return [input, button].every((element) => {
    const r = element.getBoundingClientRect();
    if (
      r.width <= 0 ||
      r.height <= 0 ||
      r.top < 0 ||
      r.bottom > height ||
      r.left < 0 ||
      r.right > width
    )
      return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === element || element.contains(hit));
  });
}
