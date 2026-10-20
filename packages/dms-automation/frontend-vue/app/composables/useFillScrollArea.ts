import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

const SCROLLS = new Set(["auto", "scroll"]);

function scrollAreaOf(element: HTMLElement): HTMLElement | null {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (SCROLLS.has(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/**
 * The min-height that lets a component fill what is left of the area it
 * scrolls in (a drawer's body), so a footer pushed down with `mt-auto` sits
 * at the bottom of the drawer when the content is short, and sticks there
 * while a longer one scrolls under it. Followed as the drawer is resized.
 * Undefined while not mounted (server render): the content keeps its height.
 */
export function useFillScrollArea(root: Ref<HTMLElement | null | undefined>) {
  const minHeight = ref<string>();
  let observer: ResizeObserver | undefined;

  function measure(area: HTMLElement, element: HTMLElement): void {
    const style = getComputedStyle(area);
    const padding =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    // Whatever sits above the component in the scroll area (a header that
    // scrolls with the body) is left out.
    const above =
      element.getBoundingClientRect().top -
      area.getBoundingClientRect().top +
      area.scrollTop -
      parseFloat(style.paddingTop);
    minHeight.value = `${Math.max(0, area.clientHeight - padding - above)}px`;
  }

  onMounted(() => {
    const element = root.value;
    const area = element && scrollAreaOf(element);
    if (!element || !area || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(() => measure(area, element));
    observer.observe(area);
    measure(area, element);
  });
  onBeforeUnmount(() => observer?.disconnect());

  return minHeight;
}
