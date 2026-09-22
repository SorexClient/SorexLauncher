export {};

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      openLogsFolder: () => Promise<void>;
      updateRPCUser: (username: string | null) => Promise<void>;
      checkLauncherUpdate: () => Promise<{ updateAvailable: boolean, version?: string, url?: string }>;
      downloadLauncherUpdate: (url: string) => Promise<{ success: boolean, error?: string }>;
      onMaximized: (callback: (maximized: boolean) => void) => void;
      login: () => Promise<any>;
      getVersions: () => Promise<any[]>;
      launchGame: (options: any) => Promise<any>;
      onLog: (callback: (data: string) => void) => void;
      onProgress: (callback: (data: any) => void) => void;
      onGameStarted: (callback: () => void) => void;
      onGameClosed: (callback: (data: any) => void) => void;
      killGame: () => Promise<boolean>;
      searchMods: (params: any) => Promise<any>;
      installMod: (params: any) => Promise<any>;
      uninstallMod: (params: any) => Promise<any>;
      getInstalledMods: (version: string) => Promise<any>;
    };
  }
}
