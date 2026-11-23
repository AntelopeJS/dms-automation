import { onMounted, ref } from "vue";

const PALETTE_HIDDEN_KEY = "dms-automation:builder-palette-hidden";
const PALETTE_FOLDED_BELOW_PX = 1280;

function readStoredHidden(): string | null {
  try {
    return window.localStorage.getItem(PALETTE_HIDDEN_KEY);
  } catch {
    return null;
  }
}

function storeHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(PALETTE_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {}
}

/** Whether the node palette is put away, remembered per browser; folded by default below xl, where it would leave the canvas too little. */
export function usePalette() {
  const paletteHidden = ref(false);
  onMounted(() => {
    const stored = readStoredHidden();
    paletteHidden.value =
      stored === null
        ? window.innerWidth < PALETTE_FOLDED_BELOW_PX
        : stored === "1";
  });
  function togglePalette() {
    paletteHidden.value = !paletteHidden.value;
    storeHidden(paletteHidden.value);
  }

  return {
    paletteHidden,
    togglePalette,
  };
}

export type Palette = ReturnType<typeof usePalette>;
