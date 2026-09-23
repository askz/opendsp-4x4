// Chooses the link implementation for the running platform: the Android shell's
// native USB bridge when present, otherwise desktop WebHID.
import type { HidLink } from "./link.ts";
import { NativeLink } from "./native.ts";
import { WebHidLink } from "./webhid.ts";

export interface LinkProvider {
  supported(): boolean;
  /** Let the user choose/grant the device (desktop: needs a user gesture). */
  pick(): Promise<HidLink | null>;
  /** An already-granted, attached device, without prompting. */
  existing(): Promise<HidLink | null>;
  /** Notify when a granted device appears. Returns an unsubscribe function. */
  onAttach(listener: (link: HidLink) => void): () => void;
}

const nativeProvider: LinkProvider = {
  supported: () => true,
  pick: async () => new NativeLink(),
  existing: async () => (NativeLink.connected() ? new NativeLink() : null),
  onAttach: (listener) => NativeLink.onAttach(listener),
};

const webHidProvider: LinkProvider = {
  supported: () => WebHidLink.supported(),
  pick: () => WebHidLink.request(),
  existing: () => WebHidLink.existing(),
  onAttach: (listener) => WebHidLink.onAttach(listener),
};

export function platformLinkProvider(): LinkProvider {
  return NativeLink.supported() ? nativeProvider : webHidProvider;
}
