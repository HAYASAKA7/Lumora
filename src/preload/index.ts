import { contextBridge, ipcRenderer } from 'electron';

import { createLumoraApi } from './api';

const api = createLumoraApi((channel, ...args) =>
  ipcRenderer.invoke(channel, ...args)
);

contextBridge.exposeInMainWorld('lumora', api);
