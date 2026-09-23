// Display names for protocol codes.
import { PeqType, Ratio, Slope } from "../protocol/commands.ts";

export const SLOPE_LABELS: Readonly<Record<number, string>> = {
  [Slope.BYPASS]: "Off",
  [Slope.BW6]: "Butterworth 6", [Slope.BL6]: "Bessel 6",
  [Slope.BW12]: "Butterworth 12", [Slope.BL12]: "Bessel 12", [Slope.LK12]: "Linkwitz-Riley 12",
  [Slope.BW18]: "Butterworth 18", [Slope.BL18]: "Bessel 18",
  [Slope.BW24]: "Butterworth 24", [Slope.BL24]: "Bessel 24", [Slope.LK24]: "Linkwitz-Riley 24",
};
export const SLOPE_CODES: readonly number[] = Object.values(Slope);

export const PEQ_TYPE_LABELS: Readonly<Record<number, string>> = {
  [PeqType.PEAK]: "Peak",
  [PeqType.LOW_SHELF]: "Low shelf",
  [PeqType.HIGH_SHELF]: "High shelf",
  [PeqType.LOW_PASS]: "Low pass",
  [PeqType.HIGH_PASS]: "High pass",
  [PeqType.ALLPASS1]: "All-pass 1",
  [PeqType.ALLPASS2]: "All-pass 2",
};
export const PEQ_TYPE_CODES: readonly number[] = Object.values(PeqType);

/** PEQ types whose gain has no effect (pass and all-pass filters). */
export const GAINLESS_PEQ_TYPES: ReadonlySet<number> = new Set([
  PeqType.LOW_PASS, PeqType.HIGH_PASS, PeqType.ALLPASS1, PeqType.ALLPASS2,
]);

export const RATIO_LABELS: readonly string[] = Ratio;

export const TONE_SOURCE_LABELS = ["Off", "Pink noise", "White noise", "Sine"] as const;

export const INPUT_LETTERS = ["A", "B", "C", "D"] as const;
