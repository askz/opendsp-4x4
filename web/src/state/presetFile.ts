// Preset files: the full device model as versioned JSON. Import is strict: every
// parameter must be present, typed and in range, or the whole file is rejected
// with the list of problems (nothing is sent to the device).
import { clone, type DeviceModel } from "./model.ts";
import { allParams, checkParam, readUntrusted, type ParamAssignment, type ParamValue } from "./params.ts";

export const PRESET_FILE_FORMAT = "opendsp-4x4/preset";
export const PRESET_FILE_VERSION = 1;
export const PRESET_FILE_EXTENSION = ".dsp4x4.json";

export interface PresetFile {
  format: typeof PRESET_FILE_FORMAT;
  version: typeof PRESET_FILE_VERSION;
  savedAt: string;
  presetName: string;
  model: DeviceModel;
}

export interface ParsedPresetFile {
  presetName: string;
  savedAt: string;
  assignments: ParamAssignment[];
}

export class PresetFileError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.length === 1 ? issues[0]! : `${issues.length} problems, first: ${issues[0]}`);
    this.name = "PresetFileError";
    this.issues = issues;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function serializePresetFile(model: DeviceModel, savedAt = new Date()): string {
  const file: PresetFile = {
    format: PRESET_FILE_FORMAT,
    version: PRESET_FILE_VERSION,
    savedAt: savedAt.toISOString(),
    presetName: model.presetName,
    model: clone(model),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A file name for an export, e.g. "Default-Preset-2026-09-23.dsp4x4.json". */
export function presetFileName(presetName: string, savedAt = new Date()): string {
  const base = presetName.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "preset";
  return `${base}-${savedAt.toISOString().slice(0, 10)}${PRESET_FILE_EXTENSION}`;
}

export function parsePresetFile(text: string): ParsedPresetFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PresetFileError(["the file is not valid JSON"]);
  }
  if (!isObject(data) || data.format !== PRESET_FILE_FORMAT) throw new PresetFileError(["not an openDSP-4x4 preset file"]);
  if (data.version !== PRESET_FILE_VERSION) {
    throw new PresetFileError([`unsupported preset file version ${String(data.version)} (this app reads version ${PRESET_FILE_VERSION})`]);
  }
  if (!isObject(data.model)) throw new PresetFileError(["the file has no model section"]);

  const issues: string[] = [];
  const assignments: ParamAssignment[] = [];
  for (const ref of allParams()) {
    const value = readUntrusted(data.model, ref);
    const problems = checkParam(ref, value);
    if (problems.length > 0) issues.push(...problems);
    else assignments.push({ ref, value: value as ParamValue | null });
  }
  if (issues.length > 0) throw new PresetFileError(issues);

  return {
    presetName: typeof data.presetName === "string" ? data.presetName : "",
    savedAt: typeof data.savedAt === "string" ? data.savedAt : "",
    assignments,
  };
}
