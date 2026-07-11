import { contextBridge, ipcRenderer } from 'electron';

import { createLumoraApi } from './api';

const api = createLumoraApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
      listener(value);
    };
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
);

contextBridge.exposeInMainWorld('lumora', api);
