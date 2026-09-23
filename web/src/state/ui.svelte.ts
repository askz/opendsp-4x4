// View state that is not device state: which tab is open (mirrored in the URL hash,
// e.g. #out-1, so reloads keep the view) and which EQ band is selected per output.
import { CHANNEL_COUNT } from "./model.ts";
import { hashToView, viewToHash, type View } from "./viewHash.ts";

export type { View };

class UiState {
  view = $state<View>(typeof location === "undefined" ? "overview" : hashToView(location.hash));
  selectedBand = $state<Record<number, number>>({});

  constructor() {
    if (typeof window === "undefined") return;
    window.addEventListener("hashchange", () => {
      this.view = hashToView(location.hash);
    });
  }

  open(view: View): void {
    if (typeof view === "number" && (view < 0 || view >= CHANNEL_COUNT)) return;
    this.view = view;
    const hash = `#${viewToHash(view)}`;
    if (typeof location !== "undefined" && location.hash !== hash) history.replaceState(null, "", hash);
  }

  bandOf(ch: number): number {
    return this.selectedBand[ch] ?? 0;
  }

  selectBand(ch: number, band: number): void {
    this.selectedBand[ch] = band;
  }
}

export const ui = new UiState();
