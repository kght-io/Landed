import { contextBridge, ipcRenderer } from "electron";

// The bridge for THIS APP'S OWN window. Named functions rather than a raw `invoke(channel, …)`,
// so the set of things the renderer can ask for is written down in one place and cannot grow by
// accident. Paths crossing here are always RELATIVE to the chosen folder — the main process
// resolves and containment-checks them (see browse.ts), because a renderer is not a trusted caller
// even when we wrote it.
contextBridge.exposeInMainWorld("landed", {
  root: () => ipcRenderer.invoke("browse:root"),
  list: (rel: string) => ipcRenderer.invoke("browse:list", rel),
  open: (rel: string) => ipcRenderer.invoke("browse:open", rel),
  reveal: (rel: string) => ipcRenderer.invoke("browse:reveal", rel),
  origin: () => ipcRenderer.invoke("app:origin"),
  openInBrowser: () => ipcRenderer.invoke("app:openInBrowser"),
  chooseRoot: () => ipcRenderer.invoke("app:chooseRoot"),
});
