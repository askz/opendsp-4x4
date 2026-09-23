// Save/open text files. Browsers use a download link and a file picker; the
// Android shell exposes a native save dialog (AndroidFiles) and implements the
// WebView file chooser for <input type="file">.

interface AndroidFilesBridge {
  /** Opens the system "save as" dialog and writes the text to the chosen document. */
  save(name: string, mimeType: string, text: string): void;
}

const androidFiles = (): AndroidFilesBridge | undefined =>
  (globalThis as unknown as { AndroidFiles?: AndroidFilesBridge }).AndroidFiles;

export function saveTextFile(name: string, text: string, mimeType = "application/json"): void {
  const bridge = androidFiles();
  if (bridge) {
    bridge.save(name, mimeType, text);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Let the user pick a text file; resolves null if they cancel. */
export function openTextFile(accept = ".json,application/json"): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) resolve(null);
      else file.text().then(resolve, () => resolve(null));
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
