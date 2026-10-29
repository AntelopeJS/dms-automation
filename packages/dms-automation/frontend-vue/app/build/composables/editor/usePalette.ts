import { onMounted, ref } from "vue";

/** Whether the node palette is put away, remembered per browser. */
export function usePalette() {
  // Below xl the inspector floats over the canvas instead of narrowing it; the
  // palette can be put away. Remembered per browser.
  const PALETTE_HIDDEN_KEY = "dms-automation:builder-palette-hidden";
  const PALETTE_FOLDED_BELOW_PX = 1280;
  const paletteHidden = ref(false);
  onMounted(() => {
    // Folded by default below xl, where it would leave the canvas too little.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(PALETTE_HIDDEN_KEY);
    } catch {
      // Storage blocked: the default for the width applies.
    }
    paletteHidden.value =
      stored === null
        ? window.innerWidth < PALETTE_FOLDED_BELOW_PX
        : stored === "1";
  });
  function togglePalette() {
    paletteHidden.value = !paletteHidden.value;
    try {
      window.localStorage.setItem(
        PALETTE_HIDDEN_KEY,
        paletteHidden.value ? "1" : "0",
      );
    } catch {
      // Storage blocked: the choice lasts until the page is left.
    }
  }

  return {
    paletteHidden,
    togglePalette,
  };
}

export type Palette = ReturnType<typeof usePalette>;
