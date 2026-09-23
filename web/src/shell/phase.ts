import type { ConnectionPhase } from "../state/connection.ts";

export const PHASE_LABELS: Readonly<Record<ConnectionPhase, string>> = {
  unsupported: "WebHID unavailable",
  idle: "Not connected",
  connecting: "Connecting…",
  syncing: "Reading device…",
  ready: "Connected",
  lost: "Connection lost",
};
