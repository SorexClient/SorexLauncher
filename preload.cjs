const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  updateRPCUser: (username) => ipcRenderer.invoke('update-rpc-user', username),
  setPresenceUser: (user) => ipcRenderer.invoke('presence:set-user', user),
  checkLauncherUpdate: () => ipcRenderer.invoke('check-launcher-update'),
  downloadLauncherUpdate: (url) => ipcRenderer.invoke('download-launcher-update', url),
  onMaximized: (callback) => ipcRenderer.on('window-is-maximized', (event, data) => callback(data)),
  login: () => ipcRenderer.invoke('ms-login'),
  getVersions: () => ipcRenderer.invoke('get-versions'),
  launchGame: (options) => ipcRenderer.invoke('launch-game', options),
  onLog: (callback) => ipcRenderer.on('log', (event, data) => callback(data)),
  onProgress: (callback) => ipcRenderer.on('progress', (event, data) => callback(data)),
  onGameStarted: (callback) => ipcRenderer.on('game-started', (event) => callback()),
  onGameClosed: (callback) => ipcRenderer.on('game-closed', (event, data) => callback(data)),
  killGame: () => ipcRenderer.invoke('kill-game'),
  searchMods: (params) => ipcRenderer.invoke('search-mods', params),
  installMod: (params) => ipcRenderer.invoke('install-mod', params),
  uninstallMod: (params) => ipcRenderer.invoke('uninstall-mod', params),
  getInstalledMods: (versionOrPayload) => ipcRenderer.invoke('get-installed-mods', versionOrPayload),
  generatePairingCode: (user) => ipcRenderer.invoke('generate-pairing-code', user),
  checkPairingStatus: (code) => ipcRenderer.invoke('check-pairing-status', code),
  onTokenRefreshed: (callback) => ipcRenderer.on('token-refreshed', (event, data) => callback(data)),

  // News
  listNews: (payload) => ipcRenderer.invoke('news:list', payload),

  // Friends
  listFriends: (uuid) => ipcRenderer.invoke('friends:list', uuid),
  addFriend: (payload) => ipcRenderer.invoke('friends:add', payload),
  removeFriend: (payload) => ipcRenderer.invoke('friends:remove', payload),
  listFriendRequests: (uuid) => ipcRenderer.invoke('friends:listRequests', uuid),
  sendFriendRequest: (payload) => ipcRenderer.invoke('friends:sendRequest', payload),
  acceptFriendRequest: (payload) => ipcRenderer.invoke('friends:acceptRequest', payload),
  rejectFriendRequest: (payload) => ipcRenderer.invoke('friends:rejectRequest', payload),

  // Messages
  listMessages: (payload) => ipcRenderer.invoke('messages:list', payload),
  sendMessage: (payload) => ipcRenderer.invoke('messages:send', payload),

  // Multiplayer servers (servers.dat)
  listMultiplayerServers: (instanceId) => ipcRenderer.invoke('multiplayer:list-servers', instanceId),

  // Instances
  listInstances: () => ipcRenderer.invoke('instances:list'),
  createInstance: (payload) => ipcRenderer.invoke('instances:create', payload),
  updateInstance: (payload) => ipcRenderer.invoke('instances:update', payload),
  deleteInstance: (id) => ipcRenderer.invoke('instances:delete', id),
  openInstanceFolder: (payload) => ipcRenderer.invoke('instances:open-folder', payload),
  listInstanceFiles: (payload) => ipcRenderer.invoke('instances:list-files', payload),
  deleteInstanceFile: (payload) => ipcRenderer.invoke('instances:delete-file', payload),
});
