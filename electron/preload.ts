import { contextBridge, ipcRenderer } from 'electron';
// Deliberately no shell, arbitrary filesystem, terminal, or Python API.
contextBridge.exposeInMainWorld('workAPI', {
  request: (operation: string, value?: unknown) =>
    ipcRenderer.invoke('work:request', operation, value),
  onChatEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on('work:chatEvent', handler);
    return () => ipcRenderer.removeListener('work:chatEvent', handler);
  },
  openWorkspace: () => ipcRenderer.invoke('work:openWorkspace'),
  workspacePath: () => ipcRenderer.invoke('work:workspacePath'),
});
