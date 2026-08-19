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

  // Agent view. onLine is a subscription rather than a poll: a drain emits lines in bursts, and
  // polling would either lag behind or spin. The unsubscribe return keeps the renderer from
  // stacking listeners when it re-renders.
  agentTypes: () => ipcRenderer.invoke("agent:types"),
  agentTranscript: (type: string) => ipcRenderer.invoke("agent:transcript", type),
  agentStatus: () => ipcRenderer.invoke("agent:status"),
  onAgentFrame: (cb: (e: { type: string; transcript: unknown }) => void) => {
    const handler = (_e: unknown, payload: { type: string; transcript: unknown }) => cb(payload);
    ipcRenderer.on("agent:frame", handler);
    return () => ipcRenderer.off("agent:frame", handler);
  },
});
