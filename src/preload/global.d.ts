import type { LumoraApi } from '../shared/contracts';

declare global {
  interface Window {
    lumora: LumoraApi;
  }
}

export {};
