export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

// Open overlays only: a closing dialog stays in the page while it animates
// out, and a non-modal card (the DMS star prompt) has no state at all.
export const OVERLAY_SELECTOR =
  ':is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])[data-state="open"]';

/** Enter belongs to a focused button or link; elsewhere it enters a group. */
export function isActivatable(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"]',
    ) !== null
  );
}
