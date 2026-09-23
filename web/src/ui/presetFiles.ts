// UI actions for preset files (shared by the top bar and the System view).
import { device } from "../state/device.svelte.ts";
import { openTextFile, saveTextFile } from "./files.ts";

export function exportPresetFile(): void {
  const file = device.exportPresetFile();
  saveTextFile(file.name, file.text);
}

export async function importPresetFile(): Promise<void> {
  const text = await openTextFile();
  if (text !== null) await device.importPresetFile(text);
}
