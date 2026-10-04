/// <reference types="vite/client" />
declare global {
  interface Window {
    workAPI: {
      request: <T = unknown>(operation: string, value?: unknown) => Promise<T>;
      onChatEvent: (listener: (event: import('./lib/workTypes').ChatEvent) => void) => () => void;
      openWorkspace: () => Promise<string | null>;
      workspacePath: () => Promise<string>;
    };
  }
}
export {};
