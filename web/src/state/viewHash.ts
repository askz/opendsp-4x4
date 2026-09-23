// URL-hash names of the views: #overview, #in-a … #in-d, #out-1 … #out-4, #system.
import { OUT_BASE } from "./model.ts";

export type View = "overview" | "system" | number;

const INPUT_HASHES = ["in-a", "in-b", "in-c", "in-d"];

export function viewToHash(view: View): string {
  if (typeof view !== "number") return view;
  return view < OUT_BASE ? INPUT_HASHES[view]! : `out-${view - OUT_BASE + 1}`;
}

export function hashToView(hash: string): View {
  const name = hash.replace(/^#/, "").toLowerCase();
  if (name === "system") return "system";
  const input = INPUT_HASHES.indexOf(name);
  if (input >= 0) return input;
  const output = /^out-([1-4])$/.exec(name);
  if (output) return OUT_BASE + Number(output[1]) - 1;
  return "overview";
}
