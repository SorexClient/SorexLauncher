const { app, BrowserWindow, ipcMain, shell } = require('electron');
const DiscordRPC = require('discord-rpc');
const clientId = '1493414477373374554'; // Placeholder - user should replace with their real Client ID
const rpc = new DiscordRPC.Client({ transport: 'ipc' });

let activeUsername = 'Guest';

function setActivity(details, state) {
  if (!rpc) return;
  rpc.setActivity({
    details: details || 'Launcher',
    state: state || (activeUsername !== 'Guest' ? `As ${activeUsername}` : 'Main Menu'),
    startTimestamp: new Date(),
    largeImageKey: 'logo',
    largeImageText: 'Sorex Launcher',
    instance: false,
  }).catch(console.error);
}

rpc.on('ready', () => {
  console.log('Discord RPC started');
  setActivity();
});

rpc.login({ clientId }).catch(console.error);
const path = require('path');
const msmc = require('msmc').default || require('msmc');
const MCLC = require('minecraft-launcher-core');
const { Client, Authenticator } = MCLC;
const { spawn, execFile } = require('child_process');
const axios = require('axios');
const fs = require('fs');

let win;
let currentGameProcess = null;

// EMERGENCY STARTUP LOG
const startupLogPath = path.join(app.getPath('userData'), 'startup.log');
fs.writeFileSync(startupLogPath, `Startup Log: ${new Date().toISOString()}\n`);
function startupLog(msg) {
  fs.appendFileSync(startupLogPath, msg + "\n");
  console.log(msg);
}

function isLikelyValidZip(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    // Tiny files are never valid jars/zips
    if (!stat.isFile() || stat.size < 22) return false;

    const fd = fs.openSync(filePath, 'r');
    try {
      const start = Buffer.alloc(4);
      fs.readSync(fd, start, 0, 4, 0);
      // ZIP local file header signature: PK\x03\x04
      if (start[0] !== 0x50 || start[1] !== 0x4b || start[2] !== 0x03 || start[3] !== 0x04) return false;

      // EOCD can be located in the last 65,557 bytes max
      const tailSize = Math.min(stat.size, 65557);
      const tail = Buffer.alloc(tailSize);
      fs.readSync(fd, tail, 0, tailSize, stat.size - tailSize);

      // EOCD signature: PK\x05\x06
      for (let i = tail.length - 22; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
          return true;
        }
      }
      return false;
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return false;
  }
}

process.on('uncaughtException', (err) => {
  startupLog(`CRITICAL ERROR: ${err.message}\n${err.stack}`);
});

const AZURE_CLIENT_ID = "6d575992-14ef-4570-a74c-61db3334675a";
const launcher = new Client();

// =============================================================
// INSTANCES — every instance has its own gameDir (mods, versions,
// libraries, assets, saves) so loadouts can't contaminate each
// other. The legacy "%APPDATA%/.sorexclient" folder is preserved
// for backwards compatibility but new launches use instance dirs.
// =============================================================
const ROOT_DIR = path.join(process.env.APPDATA || app.getPath('appData'), '.sorexclient');
const INSTANCES_ROOT = path.join(ROOT_DIR, 'instances');
const INSTANCES_INDEX = path.join(ROOT_DIR, 'instances.json');

function safeId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `inst-${Date.now().toString(36)}`;
}

function readInstances() {
  try {
    if (!fs.existsSync(INSTANCES_INDEX)) return [];
    const raw = fs.readFileSync(INSTANCES_INDEX, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    startupLog(`[Instances] read failed: ${err.message}`);
    return [];
  }
}

function writeInstances(list) {
  try {
    if (!fs.existsSync(ROOT_DIR)) fs.mkdirSync(ROOT_DIR, { recursive: true });
    fs.writeFileSync(INSTANCES_INDEX, JSON.stringify(list, null, 2));
    return true;
  } catch (err) {
    startupLog(`[Instances] write failed: ${err.message}`);
    return false;
  }
}

function ensureDefaultInstance() {
  const list = readInstances();
  if (list.length > 0) return list;
  const def = {
    id: 'default',
    name: 'Default',
    version: '1.21.4',
    loader: 'fabric',
    createdAt: Date.now(),
    totalPlaytimeSec: 0,
    lastPlayed: null,
    icon: 'grass',
  };
  writeInstances([def]);
  return [def];
}

function instanceDir(instanceId) {
  return path.join(INSTANCES_ROOT, instanceId);
}

function getInstance(instanceId) {
  const list = readInstances();
  return list.find((i) => i.id === instanceId) || null;
}

// Creates a fresh msmc Auth manager. Kept in one place so the login and the
// pre-launch token refresh always use an identical configuration (otherwise
// refresh tokens issued at login time would be rejected on refresh).
function createAuthManager() {
  return new msmc.Auth("select_account");
}

// --- CONFIGURATION ---
// No trailing slash: every call appends "/path", and "http" or "//path" each cost a redirect.
const API_BASE = "https://api.sorexclient.com"; // Production API
const API_BASE_2 = "http://localhost:8080";    // Local Testing API
const ACTIVE_API = API_BASE;                 // Switch to API_BASE for production

const WEB_BASE = "https://launcher.sorexclient.com/";
const WEB_BASE_2 = "http://localhost:5173/";    // Local UI Testing
// Set to null to load the bundled ./dist GUI; set to WEB_BASE or WEB_BASE_2 to load from URL.
const ACTIVE_WEB = null;
// ---------------------

// Presence — what friends see next to your name. The API counts a heartbeat
// as online for 120s, so beat every 30s while the launcher runs.
let presenceUser = null; // { uuid, name } of the active account, set by the renderer
let gamePresence = null; // { version, pid, host } while Minecraft runs

async function sendHeartbeat(status = 'online', user = presenceUser) {
  if (!user) return;
  const game = gamePresence;
  const server = status === 'online' && game ? await detectServer(game) : null;
  try {
    await axios.post(`${ACTIVE_API}/launcher/heartbeat`, {
      uuid: user.uuid,
      name: user.name,
      status,
      activity: game ? 'game' : 'launcher',
      version: game?.version,
      server,
    }, { timeout: 3000 });
  } catch (err) {
    startupLog(`[heartbeat] failed: ${err.message}`);
  }
}

// Minecraft logs "Connecting to host, port" on join but nothing on leave, so
// the host comes from the game log and "still there" from the game's open TCP
// sockets. Web ports and loopback are API/mod traffic, not a game server.
function detectServer(game) {
  if (!game.host) return Promise.resolve(null);
  const command = process.platform === 'win32'
    ? ['powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -State Established -OwningProcess ${Number(game.pid)} -ErrorAction SilentlyContinue | ForEach-Object { $_.RemoteAddress + ' ' + $_.RemotePort }`]]
    : ['sh', ['-c', `ss -Htnp 2>/dev/null | grep 'pid=${Number(game.pid)},'`]];
  return new Promise((resolve) => {
    execFile(command[0], command[1], { windowsHide: process.platform === 'win32', timeout: 10000 }, (err, stdout) => {
      const connected = String(stdout || '').split(/\r?\n/).some((line) => {
        const match = process.platform === 'win32'
          ? line.trim().split(/\s+/)
          : line.trim().match(/(?:\[[^\]]+\]|\S+):(\d+)\s+.*?\s+(?:\S+:)?(\S+):(\d+)\s/);
        const addr = process.platform === 'win32' ? match?.[0] : match?.[2];
        const port = process.platform === 'win32' ? match?.[1] : match?.[3];
        return port && port !== '80' && port !== '443' && !/^(127\.|::1$|0\.0\.0\.0$)/.test(addr);
      });
      resolve(connected ? game.host : null);
    });
  });
}

function createWindow() {
  startupLog("Creating window...");
  win = new BrowserWindow({
    width: 1000,
    height: 600,
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: 1000,
    minHeight: 600,
    icon: path.join(__dirname, 'public/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Prefer the local ./dist GUI for production. Only load from a URL when
  // VITE_DEV_URL is set (vite dev server) or ACTIVE_WEB is explicitly set.
  if (process.env.VITE_DEV_URL || ACTIVE_WEB) {
    const target = process.env.VITE_DEV_URL || ACTIVE_WEB;
    startupLog(`Loading UI from URL: ${target}`);
    win.loadURL(target);
  } else {
    const htmlPath = path.join(__dirname, 'dist/index.html');
    startupLog(`Loading Prod File: ${htmlPath}`);
    if (!fs.existsSync(htmlPath)) {
      startupLog(`ERROR: index.html not found at ${htmlPath}`);
    }
    win.loadFile(htmlPath);
  }

  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on('window-close', () => win.close());

  win.on('maximize', () => win.webContents.send('window-is-maximized', true));
  win.on('unmaximize', () => win.webContents.send('window-is-maximized', false));

  ipcMain.handle('update-rpc-user', (event, username) => {
    activeUsername = username || 'Guest';
    setActivity();
  });

  ipcMain.handle('presence:set-user', (event, user) => {
    const next = user?.uuid ? { uuid: user.uuid, name: user.name || '' } : null;
    if (presenceUser && presenceUser.uuid !== next?.uuid) sendHeartbeat('offline'); // switched away
    presenceUser = next;
    sendHeartbeat();
  });

  // API: Check for Launcher Updates
  ipcMain.handle('check-launcher-update', async () => {
    try {
      const response = await axios.get(`${ACTIVE_API}/launcher-version`);
      const remoteVersion = response.data.version;
      const currentVersion = app.getVersion();

      if (remoteVersion !== currentVersion) {
        return {
          updateAvailable: true,
          version: remoteVersion,
          url: response.data.downloadUrl || `${ACTIVE_API}/download/launcher`
        };
      }
      return { updateAvailable: false };
    } catch (err) {
      return { updateAvailable: false };
    }
  });

  // API: Download and start Update.exe
  ipcMain.handle('download-launcher-update', async (event, downloadUrl) => {
    try {
      const tempPath = path.join(app.getPath('temp'), 'SorexClient_Update_Setup.exe');
      const writer = fs.createWriteStream(tempPath);
      const response = await axios.get(downloadUrl, { responseType: 'stream' });

      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // Execute the update setup and quit the launcher
      shell.openPath(tempPath);
      app.quit();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-logs-folder', async () => {
    const gameDir = path.join(process.env.APPDATA, '.sorexclient');
    const logsDir = path.join(gameDir, 'launcher-logs');
    if (fs.existsSync(logsDir)) {
      shell.openPath(logsDir);
    } else {
      shell.openPath(gameDir);
    }
  });
  // API: Get versions
  ipcMain.handle('get-versions', async () => {
    try {
      const response = await axios.get(`${ACTIVE_API}/versions`);
      return response.data;
    } catch (err) {
      console.log("Backend offline, providing local fallbacks.");
      return [
        { version: "1.21.4", build_num: 1 },
        { version: "1.20.1", build_num: 1 }
      ];
    }
  });

  // API: News ─────────────────────────────────────────────────
  // GET {API_BASE}/news?limit=20
  // Returns: { news: [{ id, title, subtitle, tag, image, url, publishedAt }, ...] }
  ipcMain.handle('news:list', async (event, payload) => {
    try {
      const limit = Math.max(1, Math.min(50, payload?.limit || 20));
      const response = await axios.get(`${ACTIVE_API}/news`, {
        params: { limit },
        timeout: 10000,
      });
      const list = Array.isArray(response.data?.news) ? response.data.news : [];
      return { success: true, news: list };
    } catch (err) {
      startupLog(`[news:list] failed: ${err.message}`);
      return { success: false, error: err.message, news: [] };
    }
  });

  // API: Friends list ────────────────────────────────────────
  // GET {API_BASE}/friends?uuid={uuid}
  // Returns: { friends: [{ uuid, name, online, server?, lastSeen? }, ...] }
  ipcMain.handle('friends:list', async (event, uuid) => {
    try {
      if (!uuid) return { success: true, friends: [] };
      const response = await axios.get(`${ACTIVE_API}/friends`, {
        params: { uuid },
        timeout: 10000,
      });
      const list = Array.isArray(response.data?.friends) ? response.data.friends : [];
      return { success: true, friends: list };
    } catch (err) {
      startupLog(`[friends:list] failed: ${err.message}`);
      return { success: false, error: err.message, friends: [] };
    }
  });

  // POST {API_BASE}/friends  body: { uuid, friendName }
  ipcMain.handle('friends:add', async (event, payload) => {
    try {
      const { uuid, friendName } = payload || {};
      if (!uuid || !friendName) return { success: false, error: 'Missing uuid or friendName' };
      const response = await axios.post(
        `${ACTIVE_API}/friends`,
        { uuid, friendName },
        { timeout: 10000 }
      );
      return { success: true, friend: response.data };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  });

  // DELETE {API_BASE}/friends  body: { uuid, friendUuid }
  ipcMain.handle('friends:remove', async (event, payload) => {
    try {
      const { uuid, friendUuid } = payload || {};
      if (!uuid || !friendUuid) return { success: false, error: 'Missing uuid or friendUuid' };
      await axios.delete(`${ACTIVE_API}/friends`, {
        data: { uuid, friendUuid },
        timeout: 10000,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  });

  // Friend requests (incoming + outgoing) -----------------------------
  // GET {API_BASE}/friends/requests?uuid={uuid}
  // Returns: { incoming: [...], outgoing: [...] }
  ipcMain.handle('friends:listRequests', async (event, uuid) => {
    try {
      if (!uuid) return { success: true, incoming: [], outgoing: [] };
      const response = await axios.get(`${ACTIVE_API}/friends/requests`, {
        params: { uuid },
        timeout: 10000,
      });
      return {
        success: true,
        incoming: response.data?.incoming || [],
        outgoing: response.data?.outgoing || [],
      };
    } catch (err) {
      return { success: false, error: err.message, incoming: [], outgoing: [] };
    }
  });

  // POST {API_BASE}/friends/requests  body: { uuid, friendName }
  // Sends a friend request instead of an immediate add.
  ipcMain.handle('friends:sendRequest', async (event, payload) => {
    try {
      const { uuid, friendName } = payload || {};
      if (!uuid || !friendName) return { success: false, error: 'Missing uuid or friendName' };
      const response = await axios.post(
        `${ACTIVE_API}/friends/requests`,
        { uuid, friendName },
        { timeout: 10000 }
      );
      return { success: true, request: response.data };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  });

  // POST {API_BASE}/friends/requests/{requestId}/accept  body: { uuid }
  ipcMain.handle('friends:acceptRequest', async (event, payload) => {
    try {
      const { uuid, requestId } = payload || {};
      if (!uuid || !requestId) return { success: false, error: 'Missing uuid or requestId' };
      const response = await axios.post(
        `${ACTIVE_API}/friends/requests/${encodeURIComponent(requestId)}/accept`,
        { uuid },
        { timeout: 10000 }
      );
      return { success: true, friend: response.data };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  });

  // POST {API_BASE}/friends/requests/{requestId}/reject  body: { uuid }
  ipcMain.handle('friends:rejectRequest', async (event, payload) => {
    try {
      const { uuid, requestId } = payload || {};
      if (!uuid || !requestId) return { success: false, error: 'Missing uuid or requestId' };
      await axios.post(
        `${ACTIVE_API}/friends/requests/${encodeURIComponent(requestId)}/reject`,
        { uuid },
        { timeout: 10000 }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  });

  // Direct messages -----------------------------------------------------
  // GET {API_BASE}/messages?uuid={uuid}&peer={friendUuid}&since={ts?}
  ipcMain.handle('messages:list', async (event, payload) => {
    try {
      const { uuid, peer, since } = payload || {};
      if (!uuid || !peer) return { success: false, error: 'Missing uuid or peer', messages: [] };
      const response = await axios.get(`${ACTIVE_API}/messages`, {
        params: { uuid, peer, since },
        timeout: 10000,
      });
      return { success: true, messages: response.data?.messages || [] };
    } catch (err) {
      return { success: false, error: err.message, messages: [] };
    }
  });

  // POST {API_BASE}/messages  body: { uuid, peer, body }
  ipcMain.handle('messages:send', async (event, payload) => {
    try {
      const { uuid, peer, body } = payload || {};
      if (!uuid || !peer || !body) return { success: false, error: 'Missing field' };
      const response = await axios.post(
        `${ACTIVE_API}/messages`,
        { uuid, peer, body },
        { timeout: 10000 }
      );
      return { success: true, message: response.data };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || err.message };
    }
  });

  // API: Instances ────────────────────────────────────────────
  ipcMain.handle('instances:list', async () => {
    return ensureDefaultInstance();
  });

  ipcMain.handle('instances:create', async (event, payload) => {
    try {
      const name = (payload?.name || '').trim() || 'New Instance';
      const version = payload?.version || '1.21.4';
      const loader = payload?.loader || 'fabric';
      const icon = payload?.icon || 'grass';

      const list = readInstances();
      let id = safeId(name);
      let n = 2;
      while (list.find((i) => i.id === id)) id = `${safeId(name)}-${n++}`;

      const inst = {
        id, name, version, loader, icon,
        createdAt: Date.now(),
        totalPlaytimeSec: 0,
        lastPlayed: null,
      };
      const dir = instanceDir(id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(path.join(dir, 'mods'))) fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });

      list.push(inst);
      writeInstances(list);
      return { success: true, instance: inst };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('instances:update', async (event, payload) => {
    try {
      const list = readInstances();
      const idx = list.findIndex((i) => i.id === payload?.id);
      if (idx === -1) return { success: false, error: 'Instance not found' };
      list[idx] = { ...list[idx], ...payload, id: list[idx].id };
      writeInstances(list);
      return { success: true, instance: list[idx] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('instances:delete', async (event, instanceId) => {
    try {
      let list = readInstances();
      const inst = list.find((i) => i.id === instanceId);
      if (!inst) return { success: false, error: 'Instance not found' };
      if (list.length <= 1) return { success: false, error: 'Cannot delete the last instance' };

      const dir = instanceDir(instanceId);
      if (fs.existsSync(dir)) {
        try { fs.rmSync(dir, { recursive: true, force: true }); }
        catch (e) { startupLog(`[Instances] failed to rm ${dir}: ${e.message}`); }
      }

      list = list.filter((i) => i.id !== instanceId);
      writeInstances(list);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Read servers.dat (uncompressed NBT) for an instance, returning the
  // server list in display order. Falls back to vanilla .minecraft if
  // the instance has no servers.dat.
  // Format docs: https://minecraft.fandom.com/wiki/Servers.dat_format
  function readServersDat(filePath) {
    const buf = fs.readFileSync(filePath);
    let off = 0;
    const readByte = () => buf.readInt8(off++);
    const readUByte = () => buf.readUInt8(off++);
    const readShort = () => { const v = buf.readInt16BE(off); off += 2; return v; };
    const readInt = () => { const v = buf.readInt32BE(off); off += 4; return v; };
    const readLong = () => { const v = buf.readBigInt64BE(off); off += 8; return v; };
    const readFloat = () => { const v = buf.readFloatBE(off); off += 4; return v; };
    const readDouble = () => { const v = buf.readDoubleBE(off); off += 8; return v; };
    const readString = () => {
      const len = buf.readUInt16BE(off); off += 2;
      const s = buf.toString('utf8', off, off + len);
      off += len;
      return s;
    };
    const readPayload = (id) => {
      switch (id) {
        case 0: return null;
        case 1: return readByte();
        case 2: return readShort();
        case 3: return readInt();
        case 4: return readLong();
        case 5: return readFloat();
        case 6: return readDouble();
        case 7: { const n = readInt(); const a = Buffer.alloc(n); buf.copy(a, 0, off, off + n); off += n; return a; }
        case 8: return readString();
        case 9: {
          const tid = readUByte();
          const n = readInt();
          const arr = [];
          for (let i = 0; i < n; i++) arr.push(readPayload(tid));
          return arr;
        }
        case 10: {
          const obj = {};
          while (true) {
            const t = readUByte();
            if (t === 0) break;
            const name = readString();
            obj[name] = readPayload(t);
          }
          return obj;
        }
        case 11: { const n = readInt(); const a = []; for (let i = 0; i < n; i++) a.push(readInt()); return a; }
        case 12: { const n = readInt(); const a = []; for (let i = 0; i < n; i++) a.push(readLong()); return a; }
        default: throw new Error(`Unknown NBT tag id ${id} at offset ${off}`);
      }
    };
    // Root: TAG_Compound with name (typically "")
    const rootId = readUByte();
    if (rootId !== 10) throw new Error('servers.dat root is not a compound');
    readString(); // root name (discard)
    const root = readPayload(10);
    return Array.isArray(root.servers) ? root.servers : [];
  }

  ipcMain.handle('multiplayer:list-servers', async (event, instanceId) => {
    try {
      const candidates = [];
      const instances = ensureDefaultInstance();
      const inst = (instanceId && instances.find((i) => i.id === instanceId)) || instances[0];
      if (inst) candidates.push(path.join(instanceDir(inst.id), 'servers.dat'));
      // Fallback: legacy .sorexclient and vanilla .minecraft
      candidates.push(path.join(ROOT_DIR, 'servers.dat'));
      candidates.push(path.join(process.env.APPDATA || app.getPath('appData'), '.minecraft', 'servers.dat'));

      for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        try {
          const servers = readServersDat(file);
          const list = servers
            .filter((s) => s && (s.ip || s.name))
            .map((s) => ({ name: s.name || s.ip, ip: s.ip || '' }));
          return { success: true, servers: list, source: file };
        } catch (parseErr) {
          startupLog(`[multiplayer] parse failed for ${file}: ${parseErr.message}`);
        }
      }
      return { success: true, servers: [], source: null };
    } catch (err) {
      return { success: false, error: err.message, servers: [] };
    }
  });

  ipcMain.handle('instances:open-folder', async (event, payload) => {
    // payload can be a plain id (legacy) or { id, subfolder }
    const id = typeof payload === 'string' ? payload : payload?.id;
    const subfolder = typeof payload === 'object' ? payload?.subfolder : null;
    const base = instanceDir(id);
    const dir = subfolder ? path.join(base, subfolder) : base;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { success: true };
  });

  ipcMain.handle('instances:list-files', async (event, payload) => {
    try {
      const id = payload?.id;
      const subfolder = payload?.subfolder || '';
      const base = instanceDir(id);
      const dir = path.join(base, subfolder);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        return { success: true, files: [] };
      }
      const entries = fs.readdirSync(dir);
      const files = entries
        .filter((f) => {
          try {
            return fs.statSync(path.join(dir, f)).isFile();
          } catch { return false; }
        })
        .map((f) => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, size: st.size };
        });
      return { success: true, files };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('instances:delete-file', async (event, payload) => {
    try {
      const id = payload?.id;
      const subfolder = payload?.subfolder || '';
      const name = payload?.name;
      if (!name) return { success: false, error: 'No file name given' };
      const target = path.join(instanceDir(id), subfolder, name);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Persist additional playtime once a session ends (called from launch-game close handler)
  function addPlaytime(instanceId, seconds) {
    try {
      const list = readInstances();
      const idx = list.findIndex((i) => i.id === instanceId);
      if (idx === -1) return;
      list[idx].totalPlaytimeSec = (list[idx].totalPlaytimeSec || 0) + Math.max(0, Math.floor(seconds));
      list[idx].lastPlayed = Date.now();
      writeInstances(list);
    } catch (err) {
      startupLog(`[Instances] addPlaytime failed: ${err.message}`);
    }
  }

  // API: Microsoft Login
  ipcMain.handle('ms-login', async () => {
    try {
      const authManager = createAuthManager();
      const xboxManager = await authManager.launch("electron");
      const token = await xboxManager.getMinecraft();

      // mclc(true) embeds the refresh token + expiry in `meta`, which lets us
      // silently renew the session before every launch and avoid the dreaded
      // "Invalid session" error once the access token expires (~24h).
      const mclc = token.mclc(true);

      return {
        success: true,
        profile: {
          name: token.profile.name,
          uuid: token.profile.id,
          skin: `https://minotar.net/helm/${token.profile.name}/64`,
          accessToken: mclc.access_token,
          refreshToken: mclc.meta?.refresh || null,
          tokenExpiry: mclc.meta?.exp || null
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // API: Generate Pairing Code
  ipcMain.handle('generate-pairing-code', async (event, user) => {
    console.log("Generating code for user:", user);
    try {
      const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars like 0, O, 1, I
      let code = 'SX-';
      for (let i = 0; i < 4; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
      }

      // Send to Web Portal
      const payload = {
        code: code,
        user: {
          username: user.name,
          uuid: user.uuid,
          avatar: `https://minotar.net/helm/${user.name}/64`,
          accessToken: user.accessToken
        }
      };

      // Assuming the web app is running on localhost:3001 as per request
      const webApiUrl = "http://localhost:3001/api/launcher/generate";
      await axios.post(webApiUrl, payload);

      return { success: true, code: code };
    } catch (err) {
      console.error("Pairing Error:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('check-pairing-status', async (event, code) => {
    try {
      const response = await axios.get(`http://localhost:3001/api/launcher/status?code=${code}`);
      return { success: true, status: response.data.status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // API: Launch Minecraft
  ipcMain.handle('launch-game', async (event, options) => {
    const { version: versionFromCaller, ram, user, instanceId, quickPlayServer } = options;

    // Resolve instance — fall back to the default instance if none provided
    // so existing UIs that don't yet send instanceId still launch correctly.
    const instances = ensureDefaultInstance();
    const inst = (instanceId && instances.find((i) => i.id === instanceId)) || instances[0];
    const version = versionFromCaller || inst.version || '1.21.4';
    const gameDir = instanceDir(inst.id);
    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
    const modsDir = path.join(gameDir, 'mods');
    const sessionStartTs = Date.now();

    // 1. Setup Logging
    const logsDir = path.join(gameDir, 'launcher-logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logFilePath = path.join(logsDir, 'latest.log');
    fs.writeFileSync(logFilePath, `--- Launch Log: ${new Date().toLocaleString()} ---\n`);

    const log = (msg) => {
      console.log(msg);
      fs.appendFileSync(logFilePath, msg + "\n");
      win.webContents.send('log', msg);
    };

    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

    try {
      // 2. Sync Latest Build from API
      log(`Checking for updates for version ${version}...`);
      const response = await axios.get(`${ACTIVE_API}/versions?version=${version}`);
      const builds = response.data;

      if (builds && builds.length > 0) {
        const latest = builds[0];
        const latestBuild = latest.build_num;
        const modFileName = `SorexClient-${version}-b${latestBuild}.jar`;
        const modPath = path.join(modsDir, modFileName);
        const versionedModsDir = path.join(modsDir, version);

        const isCorrupted = fs.existsSync(modPath) && !isLikelyValidZip(modPath);
        if (!fs.existsSync(modPath) || isCorrupted) {
          if (isCorrupted) {
            log(`Detected corrupted mod file: ${modFileName}. Re-downloading...`);
            fs.unlinkSync(modPath);
          }

          if (win) win.webContents.send('log', `New build found: ${latestBuild}. Downloading...`);

          const downloadUrl = `${ACTIVE_API}/download?version=${encodeURIComponent(version)}&build=${latestBuild}`;
          let dlResponse;
          try {
            dlResponse = await axios.get(downloadUrl, { responseType: 'stream' });
          } catch (dlErr) {
            log(`Download failed for build ${latestBuild}: ${dlErr.message}`);
            throw dlErr;
          }

          // ONLY delete old files IF the download request was successful
          const oldFiles = fs.readdirSync(modsDir).filter(f => (f.startsWith('SorexClient-') || f.startsWith('NovaClient-')) && f.endsWith('.jar'));
          oldFiles.forEach(f => fs.unlinkSync(path.join(modsDir, f)));

          const writer = fs.createWriteStream(modPath);

          dlResponse.data.pipe(writer);
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
          if (!isLikelyValidZip(modPath)) {
            fs.unlinkSync(modPath);
            throw new Error(`Downloaded client JAR is invalid/corrupted: ${modFileName}`);
          }
          win.webContents.send('log', `Update to build ${latestBuild} successful!`);
        } else {
          win.webContents.send('log', `SorexClient is up to date (Build ${latestBuild}).`);
        }

        // Keep only the current build in the selected version folder.
        if (fs.existsSync(versionedModsDir)) {
          const staleVersionedFiles = fs.readdirSync(versionedModsDir).filter(f =>
            f.startsWith(`SorexClient-${version}-`) &&
            f.endsWith('.jar') &&
            f !== modFileName
          );
          for (const stale of staleVersionedFiles) {
            fs.unlinkSync(path.join(versionedModsDir, stale));
            log(`Removed old SorexClient build from ${version}: ${stale}`);
          }
        }
      }
    } catch (err) {
      win.webContents.send('log', `Update check failed: ${err.message}. Starting in offline/local mode.`);
    }

    // 3. Sync Essential Dependencies (Fabric API)
    await syncFabricApi(version, modsDir, log);
    await syncSorexClient(version, modsDir, log);

    // 4. PREPARE ACTIVE MODS FOLDER (The "Low-Tech" but most reliable way)
    const activeModsDir = path.join(gameDir, 'mods');
    const versionModsDir = path.join(activeModsDir, version);

    log(`Preparing active mods for ${version}...`);
    // Clear root mods folder first (only files, keep directories like the versioned ones)
    if (fs.existsSync(activeModsDir)) {
      const rootFiles = fs.readdirSync(activeModsDir);
      for (const f of rootFiles) {
        const fullPath = path.join(activeModsDir, f);
        if (fs.lstatSync(fullPath).isFile()) {
          fs.unlinkSync(fullPath);
        }
      }
    } else {
      fs.mkdirSync(activeModsDir, { recursive: true });
    }

    // Copy mods from versioned folder to root (skip corrupted/empty jars)
    if (fs.existsSync(versionModsDir)) {
      const vFiles = fs.readdirSync(versionModsDir);
      let syncedCount = 0;
      for (const f of vFiles) {
        const sourcePath = path.join(versionModsDir, f);
        if (!fs.lstatSync(sourcePath).isFile()) continue;

        if (f.endsWith('.jar') && !isLikelyValidZip(sourcePath)) {
          log(`Removing corrupted mod (invalid JAR): ${f}`);
          fs.unlinkSync(sourcePath);
          continue;
        }

        fs.copyFileSync(sourcePath, path.join(activeModsDir, f));
        syncedCount += 1;
      }
      log(`Synced ${syncedCount} mods to active directory.`);
    }

    let loaderVersion = "0.16.9";
    let fabricVersionName = `${version}-fabric-loader-${loaderVersion}`;
    let launchVersionName = fabricVersionName;
    let versionsDir = path.join(gameDir, 'versions', fabricVersionName);
    let versionJsonPath = path.join(versionsDir, `${fabricVersionName}.json`);

    if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });

    let fabricLoaderPath = null;

    // Always re-sync for now to ensure we have the latest merged data
    log(`Synchronizing Fabric/Vanilla metadata for ${version}...`);
    try {
      // 1. Get Vanilla Data
      const manifestRes = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const verInfo = manifestRes.data.versions.find(v => v.id === version);
      if (!verInfo) throw new Error(`Vanilla version ${version} not found in manifest.`);
      const vanillaRes = await axios.get(verInfo.url);
      const vanillaJson = vanillaRes.data;

      // 2. Resolve Fabric metadata provider (Fabric first, then LegacyFabric)
      const providers = [
        { name: 'Fabric', baseUrl: 'https://meta.fabricmc.net' },
        { name: 'LegacyFabric', baseUrl: 'https://meta.legacyfabric.net' }
      ];
      let fabricResponse = null;
      for (const provider of providers) {
        try {
          const listUrl = `${provider.baseUrl}/v2/versions/loader/${version}`;
          const listRes = await axios.get(listUrl);
          const loaders = Array.isArray(listRes.data) ? listRes.data : [];
          if (!loaders.length) {
            log(`${provider.name}: no loader versions found for ${version}.`);
            continue;
          }

          const selected = loaders.find(item => item.loader?.stable) || loaders[0];
          const selectedLoaderVersion = selected?.loader?.version;
          if (!selectedLoaderVersion) {
            log(`${provider.name}: invalid loader metadata for ${version}.`);
            continue;
          }

          const profileUrl = `${provider.baseUrl}/v2/versions/loader/${version}/${selectedLoaderVersion}/profile/json`;
          fabricResponse = await axios.get(profileUrl);
          loaderVersion = selectedLoaderVersion;
          fabricVersionName = `${version}-fabric-loader-${loaderVersion}`;
          launchVersionName = fabricVersionName;
          versionsDir = path.join(gameDir, 'versions', fabricVersionName);
          versionJsonPath = path.join(versionsDir, `${fabricVersionName}.json`);
          if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });
          log(`Using ${provider.name} loader ${loaderVersion} for ${version}.`);
          break;
        } catch (providerErr) {
          const status = providerErr?.response?.status;
          log(`${provider.name} metadata lookup failed for ${version}${status ? ` (HTTP ${status})` : ''}.`);
        }
      }
      if (!fabricResponse) {
        log(`No Fabric/LegacyFabric profile found for ${version}. Falling back to vanilla launch.`);
        log(`Skipping Fabric metadata merge for ${version}.`);
        launchVersionName = version;
      } else {
      const fabricJson = fabricResponse.data;

      // 3. Merge: Start with Vanilla, overwrite specific parts from Fabric
      const mergedJson = { ...vanillaJson };
      mergedJson.id = fabricVersionName;
      mergedJson.mainClass = fabricJson.mainClass;

      // Combine libraries (Fabric libraries first so they win if there are conflicts)
      const fabricLibs = fabricJson.libraries.map(lib => {
        const parts = lib.name.split(':');
        const group = parts[0].replace(/\./g, '/');
        const name = parts[1];
        const ver = parts[2];
        const jarName = `${name}-${ver}.jar`;

        // FIX: lib.url is often just the maven base URL (e.g. https://maven.fabricmc.net/)
        let baseUrl = lib.url || "https://maven.fabricmc.net/";
        if (!baseUrl.endsWith('/')) baseUrl += '/';

        let outLib = {
          name: lib.name,
          downloads: {}
        };

        if (lib.extract) outLib.extract = lib.extract;
        if (lib.natives) outLib.natives = lib.natives;
        if (lib.rules) outLib.rules = lib.rules;

        if (lib.natives) {
          outLib.downloads.classifiers = {};
          for (const [osName, classifierValue] of Object.entries(lib.natives)) {
            const classifier = classifierValue.replace('${arch}', '64');
            const classifierJar = `${name}-${ver}-${classifier}.jar`;
            outLib.downloads.classifiers[classifierValue] = {
              url: `${baseUrl}${group}/${name}/${ver}/${classifierJar}`,
              path: `${group}/${name}/${ver}/${classifierJar}`
            };
          }
        } else {
          outLib.downloads.artifact = {
            url: `${baseUrl}${group}/${name}/${ver}/${jarName}`,
            path: `${group}/${name}/${ver}/${jarName}`
          };
        }

        return outLib;
      });

      // 1. Create a list of all Fabric library base names (e.g., "org.ow2.asm:asm")
      const fabricPrefixes = fabricLibs.map(lib => {
        const parts = lib.name.split(':');
        return `${parts[0]}:${parts[1]}`;
      });

      // 2. Filter Vanilla libraries: Keep only those that Fabric does not override
      const filteredVanillaLibs = vanillaJson.libraries.filter(vLib => {
        if (!vLib.name) return true;
        const parts = vLib.name.split(':');
        const prefix = `${parts[0]}:${parts[1]}`;
        return !fabricPrefixes.includes(prefix);
      });

      // 3. Merge them (Fabric first, then filtered Vanilla libs)
      mergedJson.libraries = [...fabricLibs, ...filteredVanillaLibs].filter(lib => !lib.name.startsWith('net.fabricmc:fabric-loader'));

      // 4. ADD THE MINECRAFT CLIENT JAR AS A LIBRARY (Required for Knot to find the game)
      if (vanillaJson.downloads && vanillaJson.downloads.client) {
        mergedJson.libraries.push({
          name: `net.minecraft:client:${version}`,
          downloads: {
            artifact: {
              url: vanillaJson.downloads.client.url,
              path: `net/minecraft/client/${version}/client-${version}.jar`,
              size: vanillaJson.downloads.client.size,
              sha1: vanillaJson.downloads.client.sha1
            }
          }
        });
      }

      // Identify loader path for gameJar override
      const loaderLib = fabricLibs.find(l => l.name.includes('fabric-loader'));
      if (loaderLib) {
        fabricLoaderPath = path.join(gameDir, 'libraries', loaderLib.downloads.artifact.path);

        // AUTO-CLEAN: Purge all potential corrupted folders from the previous HTML bug
        if (fs.existsSync(fabricLoaderPath) && fs.statSync(fabricLoaderPath).size < 5000) {
          log(`Detected corrupted JARs (HTML files). Purging library folders...`);
          const corruptedFolders = [
            path.join(gameDir, 'libraries', 'net', 'fabricmc'),
            path.join(gameDir, 'libraries', 'org', 'ow2', 'asm'),
            path.join(gameDir, 'libraries', 'com', 'fasterxml', 'jackson')
          ];
          for (const folder of corruptedFolders) {
            if (fs.existsSync(folder)) {
              log(`Cleaning corrupted folder: ${path.basename(folder)}`);
              fs.rmSync(folder, { recursive: true, force: true });
            }
          }
        }

        log(`Found Fabric Loader at: ${fabricLoaderPath}`);
      } else {
        log(`Warning: Could not identify Fabric Loader library in metadata!`);
      }

      // Ensure we have correct arguments
      if (fabricJson.arguments) {
        mergedJson.arguments = {
          game: [...(fabricJson.arguments.game || []), ...(vanillaJson.arguments?.game || [])],
          jvm: [...(fabricJson.arguments.jvm || []), ...(vanillaJson.arguments?.jvm || [])]
        };
      }

      // Asset Index must be the vanilla one (e.g. "1.19" or "1.21")
      mergedJson.assetIndex = vanillaJson.assetIndex;

      fs.writeFileSync(versionJsonPath, JSON.stringify(mergedJson, null, 2));
      log(`Merged metadata saved successfully for ${fabricVersionName}.`);

      // 4. Manually ensure Fabric libraries are downloaded (MCLC can be picky)
      log(`Verifying Fabric dependencies...`);
      for (const lib of fabricLibs) {
        let artifactsToVerify = [];
        if (lib.downloads.artifact) artifactsToVerify.push(lib.downloads.artifact);
        if (lib.downloads.classifiers) {
          for (const key in lib.downloads.classifiers) {
             artifactsToVerify.push(lib.downloads.classifiers[key]);
          }
        }

        for (const artifact of artifactsToVerify) {
          const libPath = path.join(gameDir, 'libraries', artifact.path);
          let needsDownload = !fs.existsSync(libPath);
          if (!needsDownload && !isLikelyValidZip(libPath)) {
            log(`Detected corrupted library (invalid JAR): ${lib.name}. Re-downloading...`);
            fs.unlinkSync(libPath);
            needsDownload = true;
          }

          if (needsDownload) {
            log(`Downloading dependency: ${artifact.path}...`);
            const libDir = path.dirname(libPath);
            if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });

            try {
              const libRes = await axios.get(artifact.url, { responseType: 'arraybuffer' });
              fs.writeFileSync(libPath, Buffer.from(libRes.data));
              if (!isLikelyValidZip(libPath)) {
                fs.unlinkSync(libPath);
                throw new Error(`Downloaded library is invalid/corrupted`);
              }
            } catch (err) {
              log(`Warning: Could not download ${artifact.path}: ${err.message}`);
            }
          }
        }
      }

      // NEW: Copy Fabric Loader to the version JAR path so MCLC finds it as the "main" jar
      if (fabricLoaderPath && fs.existsSync(fabricLoaderPath)) {
        const targetJar = path.join(versionsDir, `${fabricVersionName}.jar`);
        if (!fs.existsSync(targetJar)) {
          log(`Copying loader to version JAR: ${targetJar}`);
          fs.copyFileSync(fabricLoaderPath, targetJar);
        }
      }
      }

    } catch (err) {
      log(`Metadata Sync Failed: ${err.message}`);
      return { success: false, error: "Metadata Sync Failed" };
    }

    // 5. Launch using MCLC
    let auth = {};
    if (user.isLoggedIn) {
      let accessToken = user.accessToken;
      let name = user.name;
      let uuid = user.uuid;

      // Refresh the Microsoft/Minecraft session before launching. The stored
      // access token expires after ~24h; reusing it leads to the server
      // rejecting the join with "Failed to log in: Invalid session".
      if (user.refreshToken) {
        try {
          log('Refreshing Microsoft session...');
          const authManager = createAuthManager();
          const xboxManager = await authManager.refresh(user.refreshToken);
          const token = await xboxManager.getMinecraft();
          const fresh = token.mclc(true);

          accessToken = fresh.access_token || accessToken;
          name = fresh.name || name;
          uuid = fresh.uuid || uuid;

          // Persist the rotated token back in the renderer so it stays valid.
          win.webContents.send('token-refreshed', {
            uuid,
            name,
            accessToken,
            refreshToken: fresh.meta?.refresh || user.refreshToken,
            tokenExpiry: fresh.meta?.exp || null
          });
          log('Session refreshed successfully.');
        } catch (refreshErr) {
          log(`Session refresh failed: ${refreshErr.message}. Falling back to stored token.`);
        }
      }

      auth = {
        access_token: accessToken,
        client_token: uuid,
        uuid: uuid,
        name: name,
        user_properties: '{}'
      };
    } else {
      // MCLC v3.18.2 uses getAuth(username) without password for offline mode
      try {
        auth = await Authenticator.getAuth(user.name);
      } catch (authErr) {
        log(`Offline auth failed: ${authErr.message}`);
        return { success: false, error: "Auth Library Error" };
      }
    }

    // MCLC distinguishes JVM args (customArgs) vs game args (customLaunchArgs).
    // -D* and -DlaunchTarget belong to the JVM; --server / --port go to the game.
    const jvmCustomArgs = launchVersionName === fabricVersionName
      ? [
          "-DlaunchTarget=knot_client",
          "-Dfabric.loader.accessor.naming=official",
          `-Dfabric.gameDir=${gameDir.replace(/\\/g, '/')}`
        ]
      : [];

    const gameCustomArgs = [];
    if (quickPlayServer && quickPlayServer.host) {
      const port = String(quickPlayServer.port || 25565);
      gameCustomArgs.push("--server", String(quickPlayServer.host), "--port", port);
      log(`Quick-connecting to ${quickPlayServer.host}:${port} on launch.`);
    }

    const opts = {
      authorization: auth,
      root: gameDir,
      javaPath: await ensureJava(win, gameDir, log),
      version: {
        number: launchVersionName,
        type: 'release'
      },
      memory: {
        max: `${ram}G`,
        min: "1G"
      },
      customArgs: jvmCustomArgs,
      customLaunchArgs: gameCustomArgs,
      overrides: {
        detached: false
      }
    };

    try {
      log(`Starting launch process...`);
      // Use the 'minecraft-launcher-core' events
      launcher.on('debug', (e) => log(`[DEBUG] [MCLC]: ${e}`));
      launcher.on('data', (e) => {
        log(`[DATA] [MCLC]: ${e}`);
        // Anchored to the log prefix so a chat message can't fake a join.
        const join = /^\[[\d:]+\] \[[^\]]+\/INFO\]: Connecting to ([^,\s]+), (\d+)\s*$/m.exec(e);
        if (join && gamePresence) {
          gamePresence.host = join[2] === '25565' ? join[1] : `${join[1]}:${join[2]}`;
          setTimeout(() => sendHeartbeat(), 5000); // once the connection is up
        }
      });

      launcher.on('close', async (e) => {
        log(`Game closed with code ${e}`);
        currentGameProcess = null;
        gamePresence = null;
        const elapsedSec = Math.floor((Date.now() - sessionStartTs) / 1000);
        addPlaytime(inst.id, elapsedSec);
        win.webContents.send('game-closed', { code: e, instanceId: inst.id, elapsedSec });
        setActivity(); // Reset to Main Menu
        await sendHeartbeat(); // back in the launcher
      });

      currentGameProcess = await launcher.launch(opts);
      log(`Launch command executed. Process ID: ${currentGameProcess.pid}`);
      gamePresence = { version, pid: currentGameProcess.pid, host: null };
      win.webContents.send('game-started');
      setActivity(`Playing Minecraft (${version})`, `As ${activeUsername}`);
      await sendHeartbeat();

    } catch (launchErr) {
      log(`CRITICAL LAUNCH ERROR: ${launchErr.message}`);
      if (launchErr.stack) log(launchErr.stack);
      currentGameProcess = null;
      gamePresence = null;
      win.webContents.send('game-closed');
      await sendHeartbeat();
    }

    return { success: true };
  });

  // API: Kill the process
  ipcMain.handle('kill-game', async () => {
    if (currentGameProcess) {
      console.log("Killing game process...");
      currentGameProcess.kill();
      currentGameProcess = null;
      return true;
    }
    return false;
  });

  ipcMain.handle('uninstall-mod', async (event, { slug, title, version, instanceId }) => {
    try {
      const instances = ensureDefaultInstance();
      const inst = (instanceId && instances.find((i) => i.id === instanceId)) || instances[0];
      const gameDir = instanceDir(inst.id);
      const modsDir = path.join(gameDir, 'mods', version || inst.version);
      if (!fs.existsSync(modsDir)) return { success: true };

      const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
      const s = slug?.toLowerCase();
      const t = title?.toLowerCase().replace(/\s+/g, '-');

      const toDelete = files.filter(f => {
        const fn = f.toLowerCase();
        return fn.includes(s) || fn.includes(t);
      });

      for (const f of toDelete) {
        fs.unlinkSync(path.join(modsDir, f));
      }

      return { success: true, count: toDelete.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-installed-mods', async (event, versionOrPayload) => {
    try {
      // Accept either a raw version string (legacy) or { version, instanceId }
      const isObj = versionOrPayload && typeof versionOrPayload === 'object';
      const version = isObj ? versionOrPayload.version : versionOrPayload;
      const instanceId = isObj ? versionOrPayload.instanceId : null;
      const instances = ensureDefaultInstance();
      const inst = (instanceId && instances.find((i) => i.id === instanceId)) || instances[0];
      const gameDir = instanceDir(inst.id);
      const modsDir = path.join(gameDir, 'mods', version || inst.version);

      if (!fs.existsSync(modsDir)) {
        await fs.promises.mkdir(modsDir, { recursive: true });
        return { success: true, mods: [] };
      }

      const files = await fs.promises.readdir(modsDir);
      const modFiles = files.filter(f => {
        if (!f.endsWith('.jar')) return false;
        
        try {
          const stats = fs.statSync(path.join(modsDir, f));
          return stats.isFile() && stats.size > 0; // Ignore directories and empty files
        } catch (e) {
          return false;
        }
      });

      return { success: true, mods: modFiles };
    } catch (err) {
      console.error(`Error listing mods for ${version}:`, err);
      return { success: false, error: err.message };
    }
  });

  // Modrinth content kinds:
  //  - "mod"           → mods/{version}/        (per-version, Fabric loader)
  //  - "resourcepack"  → resourcepacks/         (version-agnostic folder)
  //  - "shader"        → shaderpacks/           (Iris/OptiFine compatible)
  function modrinthProjectType(kind) {
    if (kind === 'shader') return 'shader';
    if (kind === 'resourcepack') return 'resourcepack';
    if (kind === 'modpack') return 'modpack';
    return 'mod';
  }

  function destFolderForKind(gameDir, kind, version) {
    if (kind === 'shader') return path.join(gameDir, 'shaderpacks');
    if (kind === 'resourcepack') return path.join(gameDir, 'resourcepacks');
    return path.join(gameDir, 'mods', version);
  }

  function safeInstancePath(gameDir, relativePath) {
    const normalized = String(relativePath || '').replace(/\//g, path.sep);
    const target = path.resolve(gameDir, normalized);
    const root = path.resolve(gameDir) + path.sep;
    if (!target.startsWith(root)) throw new Error(`Unsafe modpack path: ${relativePath}`);
    return target;
  }

  function copyDirectoryContents(sourceDir, gameDir, minecraftVersion, currentDir = sourceDir) {
    if (!fs.existsSync(currentDir)) return;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const source = path.join(currentDir, entry.name);
      const relative = path.relative(sourceDir, source);
      const packRelative = relative.startsWith(`mods${path.sep}`)
        ? path.join('mods', minecraftVersion, relative.slice(`mods${path.sep}`.length))
        : relative;
      const target = safeInstancePath(gameDir, packRelative);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copyDirectoryContents(sourceDir, gameDir, minecraftVersion, source);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    }
  }

  async function downloadFile(url, targetPath) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000,
      headers: { 'User-Agent': 'SorexLauncher/2.0.5 (launcher@sorexclient.com)' },
    });
    const writer = fs.createWriteStream(targetPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async function installModrinthModpack(modId, instanceId) {
    const instances = ensureDefaultInstance();
    const inst = (instanceId && instances.find((i) => i.id === instanceId)) || instances[0];
    const gameDir = instanceDir(inst.id);
    const versionsResponse = await axios.get(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(modId)}/version`,
      { params: { loaders: JSON.stringify(['fabric']) }, timeout: 15000 }
    );
    const packVersion = versionsResponse.data?.[0];
    if (!packVersion) throw new Error('No compatible Fabric modpack version found');
    const packFile = packVersion.files?.find((file) => file.primary && file.filename.endsWith('.mrpack'))
      || packVersion.files?.find((file) => file.filename.endsWith('.mrpack'));
    if (!packFile) throw new Error('Modrinth version has no .mrpack file');

    const tempRoot = path.join(app.getPath('temp'), `sorex-mrpack-${Date.now()}`);
    const archivePath = path.join(tempRoot, 'pack.zip');
    const extractDir = path.join(tempRoot, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      win?.webContents.send('log', `Downloading Modrinth modpack ${packVersion.name}...`);
      await downloadFile(packFile.url, archivePath);
      await new Promise((resolve, reject) => {
        const proc = process.platform === 'win32'
          ? spawn('powershell', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
            'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
            archivePath, extractDir,
          ], { windowsHide: true })
          : spawn('unzip', ['-o', archivePath, '-d', extractDir]);
        proc.on('error', reject);
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Modpack extraction failed (${code})`)));
      });

      const indexPath = path.join(extractDir, 'modrinth.index.json');
      if (!fs.existsSync(indexPath)) throw new Error('Invalid .mrpack: modrinth.index.json missing');
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const minecraftVersion = index.dependencies?.minecraft;
      if (!minecraftVersion) throw new Error('Invalid .mrpack: Minecraft version missing');

      const files = (Array.isArray(index.files) ? index.files : []).filter(
        (file) => file.env?.client !== 'unsupported' && file.downloads?.[0],
      );
      let completed = 0;
      for (const file of files) {
        const downloadUrl = file.downloads?.[0];
        const relative = String(file.path || '');
        const targetRelative = relative.startsWith('mods/')
          ? path.join('mods', minecraftVersion, relative.slice(5))
          : relative;
        await downloadFile(downloadUrl, safeInstancePath(gameDir, targetRelative));
        completed += 1;
        win?.webContents.send('progress', {
          type: 'Modpack Download',
          percent: Math.round((completed / Math.max(files.length, 1)) * 100),
        });
      }

      copyDirectoryContents(path.join(extractDir, 'overrides'), gameDir, minecraftVersion);
      copyDirectoryContents(path.join(extractDir, 'client-overrides'), gameDir, minecraftVersion);

      const list = readInstances();
      const idx = list.findIndex((item) => item.id === inst.id);
      if (idx !== -1) {
        list[idx] = {
          ...list[idx],
          version: minecraftVersion,
          loader: index.dependencies?.['fabric-loader'] ? 'fabric' : list[idx].loader,
          modpackProjectId: modId,
          modpackVersionId: packVersion.id,
          modpackName: index.name || packVersion.name,
        };
        writeInstances(list);
      }
      win?.webContents.send('log', `Modpack ${index.name || packVersion.name} installed successfully.`);
      return { success: true, instance: idx !== -1 ? list[idx] : inst };
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }

  const modrinthSearchCache = new Map();
  const modrinthSearchInFlight = new Map();
  const MODRINTH_SEARCH_CACHE_MS = 5 * 60 * 1000;
  let modrinthRateLimitedUntil = 0;

  ipcMain.handle('search-mods', async (event, { query, version, kind }) => {
    const normalizedQuery = String(query || '').trim();
    const projectType = modrinthProjectType(kind);
    const cacheKey = JSON.stringify([normalizedQuery.toLowerCase(), version, projectType]);
    const cached = modrinthSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < MODRINTH_SEARCH_CACHE_MS) {
      return { success: true, mods: cached.mods, cached: true };
    }
    if (Date.now() < modrinthRateLimitedUntil) {
      if (cached) return { success: true, mods: cached.mods, cached: true, stale: true };
      const retryIn = Math.max(1, Math.ceil((modrinthRateLimitedUntil - Date.now()) / 1000));
      return {
        success: false,
        error: `Modrinth rate limit reached. Try again in ${retryIn} seconds.`,
        rateLimited: true,
      };
    }

    try {
      const facets = [[`project_type:${projectType}`]];
      if (projectType !== 'modpack') facets.unshift([`versions:${version}`]);
      // Only mods need a loader facet — packs/shaders don't gate on loader.
      if (projectType === 'mod') facets.push(['categories:fabric']);

      const params = {
        facets: JSON.stringify(facets),
        limit: 20
      };

      if (normalizedQuery) {
        params.query = normalizedQuery;
      } else {
        params.index = "downloads";
      }

      let request = modrinthSearchInFlight.get(cacheKey);
      if (!request) {
        request = axios.get('https://api.modrinth.com/v2/search', {
          params,
          timeout: 15000,
          headers: {
            'User-Agent': 'SorexLauncher/2.0.5 (launcher@sorexclient.com)',
          },
        }).then((response) => response.data.hits || []);
        modrinthSearchInFlight.set(cacheKey, request);
      }

      const mods = await request;
      modrinthSearchCache.set(cacheKey, { createdAt: Date.now(), mods });
      return { success: true, mods };
    } catch (err) {
      console.error('[search-mods] failed:', err.message);
      if (err.response?.status === 429) {
        const retryAfterHeader = Number(err.response.headers?.['retry-after']);
        const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader
          : 60;
        modrinthRateLimitedUntil = Date.now() + retryAfter * 1000;
        if (cached) return { success: true, mods: cached.mods, cached: true, stale: true };
        return {
          success: false,
          error: `Modrinth rate limit reached. Try again in ${retryAfter} seconds.`,
          rateLimited: true,
        };
      }
      return { success: false, error: err.message };
    } finally {
      modrinthSearchInFlight.delete(cacheKey);
    }
  });

  ipcMain.handle('install-mod', async (event, { modId, version, instanceId, kind }) => {
    try {
      if (kind === 'modpack') return await installModrinthModpack(modId, instanceId);
      const instances = ensureDefaultInstance();
      const inst = (instanceId && instances.find((i) => i.id === instanceId)) || instances[0];
      const effectiveVersion = version || inst.version;
      const gameDir = instanceDir(inst.id);
      const destDir = destFolderForKind(gameDir, kind, effectiveVersion);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      // Resolve project versions. Mods filter by loader; packs/shaders don't.
      const versionParams = { game_versions: JSON.stringify([effectiveVersion]) };
      if (!kind || kind === 'mod') versionParams.loaders = JSON.stringify(["fabric"]);

      const versionsResponse = await axios.get(
        `https://api.modrinth.com/v2/project/${modId}/version`,
        { params: versionParams }
      );

      const versions = versionsResponse.data;
      if (versions.length === 0) throw new Error("No compatible version found on Modrinth");

      const latestVersion = versions[0];
      const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];
      const destPath = path.join(destDir, primaryFile.filename);

      if (fs.existsSync(destPath)) return { success: true, message: "Already installed" };

      const downloadResponse = await axios.get(primaryFile.url, { responseType: 'stream' });
      const writer = fs.createWriteStream(destPath);
      downloadResponse.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      return { success: true, filename: primaryFile.filename };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  async function ensureJava(win, gameDir, log) {
    const javaPath = findJava();
    if (javaPath !== "java" && javaPath.includes('21')) return javaPath;

    // We explicitly need Java 21 for 1.20.5+
    const runtimeDir = path.join(gameDir, 'runtime');
    const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java';

    // AUTO-UPGRADE: If we have an old Java 17 runtime, wipe it to install Java 21
    const files = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir) : [];
    const olderJre = files.find(f => f.startsWith('jdk-17') || f.startsWith('jre-17'));
    if (olderJre) {
      log("Old Java 17 runtime detected. Purging for upgrade to Java 21...");
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }

    // Check if we already have it in the runtime folder
    const updatedFiles = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir) : [];
    const existingJre = updatedFiles.find(f => (f.startsWith('jdk-21') || f.startsWith('jre-21')) && fs.existsSync(path.join(runtimeDir, f, 'bin', javaExecutable)));
    if (existingJre) return path.join(runtimeDir, existingJre, 'bin', javaExecutable);

    log("Java 21 not found. Downloading portable JRE 21 (Required for 1.21.4)...");
    if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });

    // Temurin 21 JRE via direct link
    const isWindows = process.platform === 'win32';
    const archiveName = isWindows ? 'jre21.zip' : 'jre21.tar.gz';
    const dlUrl = isWindows
      ? "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jre_x64_windows_hotspot_21.0.6_7.zip"
      : "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.6%2B7/OpenJDK21U-jre_x64_linux_hotspot_21.0.6_7.tar.gz";
    const archivePath = path.join(runtimeDir, archiveName);

    try {
      const response = await axios.get(dlUrl, {
        responseType: 'stream',
        onDownloadProgress: (p) => {
          const percent = Math.round((p.loaded * 100) / p.total);
          win.webContents.send('progress', { type: 'Java 21 Download', percent });
        }
      });

      const writer = fs.createWriteStream(archivePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      log("Extracting Java 21... This may take a moment.");
      await new Promise((resolve, reject) => {
        const prc = isWindows
          ? spawn('powershell', ['-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${runtimeDir}" -Force`], { windowsHide: true })
          : spawn('tar', ['-xzf', archivePath, '-C', runtimeDir]);
        prc.on('error', reject);
        prc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Java extraction failed (${code})`)));
      });

      fs.unlinkSync(archivePath);

      const finalFiles = fs.readdirSync(runtimeDir);
      const jreFolder = finalFiles.find(f => f.startsWith('jdk-21') || f.startsWith('jre-21'));
      if (jreFolder) {
        const realPath = path.join(runtimeDir, jreFolder, 'bin', javaExecutable);
        fs.chmodSync(realPath, 0o755);
        log(`Java 21 installed successfully!`);
        return realPath;
      }
    } catch (err) {
      log(`Java Download Failed: ${err.message}`);
    }

    return "java";
  }

  async function syncFabricApi(version, modsRoot, log) {
    const modsDir = path.join(modsRoot, version);
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

    const fabricApiVersions = {
      "1.21.4": "0.113.0+1.21.4",
      "1.21.3": "0.111.0+1.21.3",
      "1.21.1": "0.106.0+1.21.1",
      "1.21": "0.102.0+1.21",
      "1.20.6": "0.100.1+1.20.6",
      "1.20.4": "0.97.0+1.20.4",
      "1.20.1": "0.92.1+1.20.1",
      "1.19.4": "0.87.0+1.19.4",
      "1.19.2": "0.76.1+1.19.2"
    };

    const ver = fabricApiVersions[version];
    if (!ver) {
      log(`Warning: No Fabric API mapping for ${version}. Skipping dependency sync.`);
      return;
    }

    const jarName = `fabric-api-${ver}.jar`;
    const jarPath = path.join(modsDir, jarName);

    const isCorrupted = fs.existsSync(jarPath) && fs.statSync(jarPath).size === 0;
    if (fs.existsSync(jarPath) && !isCorrupted) {
      log(`Fabric API ${ver} is already up to date.`);
    } else {
      if (isCorrupted) {
        log(`Detected empty Fabric API file. Re-downloading...`);
        fs.unlinkSync(jarPath);
      }

      // Cleanup old Fabric API versions in the specific version folder
      const files = fs.readdirSync(modsDir);
      for (const f of files) {
        if (f.startsWith('fabric-api-') && f.endsWith('.jar')) {
          fs.unlinkSync(path.join(modsDir, f));
        }
      }

      log(`Downloading Fabric API ${ver} for ${version}...`);
      const url = `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${ver}/fabric-api-${ver}.jar`;

      try {
        const response = await axios.get(url, { responseType: 'stream' });
        const writer = fs.createWriteStream(jarPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        log(`Fabric API synchronized successfully.`);
      } catch (err) {
        log(`Failed to download Fabric API: ${err.message}`);
      }
    }
  }


  async function syncSorexClient(version, modsRoot, log) {
    const targetDir = path.join(modsRoot, version);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // Look for SorexClient in the root mods folder and move it to the versioned folder
    const rootMods = fs.readdirSync(modsRoot);
    for (const f of rootMods) {
      if ((f.startsWith('SorexClient') || f.startsWith('NovaClient')) && f.endsWith('.jar')) {
        const oldPath = path.join(modsRoot, f);
        if (!fs.lstatSync(oldPath).isFile()) continue;

        // Delete corrupted jars immediately to prevent Fabric loader crashes.
        if (!isLikelyValidZip(oldPath)) {
          log(`Deleting corrupted root mod (invalid JAR): ${f}`);
          fs.unlinkSync(oldPath);
          continue;
        }

        // Only move jars that match the currently selected MC version.
        if (!f.includes(`-${version}-`)) {
          log(`Skipping non-matching SorexClient jar for ${version}: ${f}`);
          continue;
        }

        const staleVersionedFiles = fs.readdirSync(targetDir).filter(fileName =>
          fileName.startsWith(`SorexClient-${version}-`) &&
          fileName.endsWith('.jar') &&
          fileName !== f.replace('NovaClient', 'SorexClient')
        );
        for (const stale of staleVersionedFiles) {
          fs.unlinkSync(path.join(targetDir, stale));
          log(`Removed old SorexClient build from ${version}: ${stale}`);
        }

        const newPath = path.join(targetDir, f.replace('NovaClient', 'SorexClient'));
        if (fs.existsSync(newPath) && !isLikelyValidZip(newPath)) {
          log(`Removing corrupted versioned mod (invalid JAR): ${path.basename(newPath)}`);
          fs.unlinkSync(newPath);
        }

        if (!fs.existsSync(newPath)) {
          log(`Moving and renaming ${f} to versioned folder (${version})...`);
          fs.renameSync(oldPath, newPath);
        }
      }
    }
  }

  function findJava() {
    if (process.env.JAVA_HOME) {
      const homePath = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(homePath)) return homePath;
    }

    const mcPaths = process.platform === 'win32'
      ? [
        path.join(process.env.LOCALAPPDATA || '', 'Packages/Microsoft.42941243D6E72_8wekyb3d8bbwe/LocalCache/Local/runtime/java-runtime-gamma/windows-x64/java-runtime-gamma/bin/java.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'runtime/java-runtime-gamma/windows-x64/java-runtime-gamma/bin/java.exe'),
        'C:\\Program Files (x86)\\Minecraft Launcher\\runtime\\java-runtime-gamma\\windows-x64\\java-runtime-gamma\\bin\\java.exe'
      ]
      : [
        path.join(process.env.HOME || '', '.minecraft/runtime/java-runtime-gamma/linux-x64/java-runtime-gamma/bin/java'),
        path.join(process.env.HOME || '', '.minecraft/runtime/java-runtime-gamma/linux/java-runtime-gamma/bin/java')
      ];

    for (const p of mcPaths) {
      if (fs.existsSync(p)) return p;
    }

    return "java";
  }
}

app.whenReady().then(() => {
  createWindow();
  setInterval(() => sendHeartbeat(), 30_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Show friends "offline" right away instead of after the 120s online window.
let offlineBeatSent = false;
app.on('before-quit', (event) => {
  if (offlineBeatSent || !presenceUser) return;
  offlineBeatSent = true;
  event.preventDefault();
  sendHeartbeat('offline').finally(() => app.quit());
});
