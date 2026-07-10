import { contextBridge, ipcRenderer } from 'electron';

import { createLumoraApi } from './api';

const api = createLumoraApi((channel) => ipcRenderer.invoke(channel));

contextBridge.exposeInMainWorld('lumora', api);
