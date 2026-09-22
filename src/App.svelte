<script lang="ts">
  import TopBar from "./lib/TopBar.svelte";
  import SidePanel from "./lib/SidePanel.svelte";
  import PlayButton from "./lib/PlayButton.svelte";
  import Console from "./lib/Console.svelte";
  import SkinViewer from "./lib/SkinViewer.svelte";
  import InstanceModal from "./lib/InstanceModal.svelte";
  import InstancePicker from "./lib/InstancePicker.svelte";
  import FriendsPanel from "./lib/FriendsPanel.svelte";
  import NewsPanel from "./lib/NewsPanel.svelte";
  import HeroPlayButton from "./lib/HeroPlayButton.svelte";
  import { t, AVAILABLE_LANGS, languagePreference } from "./lib/i18n";
  import { presenceText, headUrl, type Friend } from "./lib/presence";
  import { get } from "svelte/store";
  import {
    Terminal,
    Plus,
    Folder,
    Trash2,
    Box,
    Clock,
    Gamepad2,
    ChevronDown,
    Server,
  } from "lucide-svelte";
  import { onMount, tick } from "svelte";
  import { writable } from "svelte/store";

  // -------------------------------------------------------------
  // App appearance / sound settings (persisted to localStorage and
  // mirrored to data-* attributes on <html> so CSS can react).
  // -------------------------------------------------------------
  const THEMES = [
    { id: "lime", label: "Lime", swatch: "#a3e635" },
    { id: "azure", label: "Azure", swatch: "#3b82f6" },
    { id: "rose", label: "Rose", swatch: "#f43f5e" },
    { id: "violet", label: "Violet", swatch: "#8b5cf6" },
    { id: "amber", label: "Amber", swatch: "#f59e0b" },
    { id: "mono", label: "Mono", swatch: "#ffffff" },
  ];

  function persisted<T>(key: string, fallback: T) {
    const init =
      (typeof localStorage !== "undefined" && localStorage.getItem(key)) || null;
    const store = writable<T>(init !== null ? (JSON.parse(init) as T) : fallback);
    if (typeof localStorage !== "undefined") {
      store.subscribe((v) => {
        try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
      });
    }
    return store;
  }

  const themeStore = persisted<string>("sorex_theme", "lime");
  // Migrate older saved value "default" → new default "lime"
  themeStore.update((v) => (v === "default" ? "lime" : v));
  const soundStore = persisted<boolean>("sorex_sounds", true);
  const uiModeStore = persisted<"modern" | "legacy">("sorex_ui_mode", "modern");

  // Mirror to <html data-*> so global CSS can override everywhere.
  $: if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", $themeStore);
    document.documentElement.setAttribute("data-ui-mode", $uiModeStore);
  }

  // Tiny WebAudio click — no asset file needed.
  let audioCtx: AudioContext | null = null;
  function playClick() {
    if (!$soundStore) return;
    try {
      if (!audioCtx) audioCtx = new AudioContext();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "triangle";
      o.frequency.value = 660;
      g.gain.value = 0.08;
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.12);
    } catch {}
  }

  // Friends — fetched from the API for the logged-in account.
  // See FRIENDS_API_PROMPT.md for the expected endpoint contract.
  let friends: Friend[] = [];
  let friendsPollTimer: any = null;

  async function refreshFriends() {
    const uuid = activeAccountId;
    if (!uuid) {
      friends = [];
      return;
    }
    try {
      // @ts-ignore
      const res = await window.electronAPI?.listFriends?.(uuid);
      if (res?.success) {
        // Online first; the API already sorts by name and sort() is stable.
        friends = (res.friends as Friend[]).sort((a, b) => Number(b.online) - Number(a.online));
        // Keep the open chat's header status live.
        if (selectedChatPeer) selectedChatPeer = friends.find((f) => f.uuid === selectedChatPeer?.uuid) ?? selectedChatPeer;
      }
    } catch (err) {
      console.warn("[friends] refresh failed:", err);
    }
  }

  // Re-pull whenever the active account changes, and poll every 30s while running.
  $: if (activeAccountId) refreshFriends();

  // ---------- Friend requests + DM chat ---------------------------
  type FriendRequest = {
    id: string;
    from?: { uuid: string; name: string };
    to?:   { uuid: string; name: string };
    createdAt?: number;
  };
  type ChatMessage = {
    id: string;
    from: string;   // uuid
    body: string;
    sentAt: number;
  };

  let incomingRequests: FriendRequest[] = [];
  let outgoingRequests: FriendRequest[] = [];
  let addFriendName = "";
  let addFriendBusy = false;
  let addFriendError = "";

  let selectedChatPeer: Friend | null = null;
  let chatMessages: ChatMessage[] = [];
  let chatDraft = "";
  let chatSending = false;
  let chatPollTimer: any = null;
  let chatBodyEl: HTMLDivElement | null = null;

  // The API returns dashed UUIDs; the Microsoft login stores them without dashes.
  const plainUuid = (u?: string | null) => (u || "").replace(/-/g, "").toLowerCase();
  $: myPlainUuid = plainUuid(activeAccountId);

  async function refreshFriendRequests() {
    const uuid = activeAccountId;
    if (!uuid) {
      incomingRequests = [];
      outgoingRequests = [];
      return;
    }
    try {
      // @ts-ignore
      const res = await window.electronAPI?.listFriendRequests?.(uuid);
      if (res?.success) {
        incomingRequests = res.incoming as FriendRequest[];
        outgoingRequests = res.outgoing as FriendRequest[];
      }
    } catch (err) {
      console.warn("[friends] refresh requests failed:", err);
    }
  }
  $: if (activeAccountId) refreshFriendRequests();

  async function handleAddFriend() {
    const name = addFriendName.trim();
    if (!name) return;
    addFriendBusy = true;
    addFriendError = "";
    try {
      // @ts-ignore
      const res = await window.electronAPI?.sendFriendRequest?.({
        uuid: activeAccountId,
        friendName: name,
      });
      if (res?.success) {
        addFriendName = "";
        await refreshFriendRequests();
      } else {
        addFriendError = res?.error || "Failed to send request";
      }
    } finally {
      addFriendBusy = false;
    }
  }

  async function acceptRequest(req: FriendRequest) {
    // @ts-ignore
    const res = await window.electronAPI?.acceptFriendRequest?.({
      uuid: activeAccountId,
      requestId: req.id,
    });
    if (res?.success) {
      await refreshFriendRequests();
      await refreshFriends();
    }
  }

  async function rejectRequest(req: FriendRequest) {
    // @ts-ignore
    const res = await window.electronAPI?.rejectFriendRequest?.({
      uuid: activeAccountId,
      requestId: req.id,
    });
    if (res?.success) await refreshFriendRequests();
  }

  async function openChat(friend: Friend) {
    selectedChatPeer = friend;
    chatMessages = [];
    chatDraft = "";
    await refreshChatMessages();
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(refreshChatMessages, 5_000);
  }

  function closeChat() {
    selectedChatPeer = null;
    chatMessages = [];
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = null;
  }

  async function refreshChatMessages() {
    if (!selectedChatPeer?.uuid || !activeAccountId) return;
    // @ts-ignore
    const res = await window.electronAPI?.listMessages?.({
      uuid: activeAccountId,
      peer: selectedChatPeer.uuid,
    });
    if (!res?.success) return;
    const next = res.messages as ChatMessage[];
    if (next.at(-1)?.id === chatMessages.at(-1)?.id) return; // nothing new
    // Follow new messages unless the user scrolled up to read older ones.
    const el = chatBodyEl;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    chatMessages = next;
    await tick();
    if (atBottom && chatBodyEl) chatBodyEl.scrollTop = chatBodyEl.scrollHeight;
  }

  async function sendChatMessage() {
    const body = chatDraft.trim();
    if (!body || !selectedChatPeer?.uuid || !activeAccountId) return;
    chatSending = true;
    chatDraft = "";
    try {
      // @ts-ignore
      const res = await window.electronAPI?.sendMessage?.({
        uuid: activeAccountId,
        peer: selectedChatPeer.uuid,
        body,
      });
      if (res?.success) {
        await refreshChatMessages();
      } else {
        chatDraft = body; // restore so user can retry
      }
    } finally {
      chatSending = false;
    }
  }

  function formatChatTime(ts: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString()} ${time}`;
  }

  // News — fetched from the API. See NEWS_API_PROMPT.md for the contract.
  type NewsItem = {
    id?: string;
    title: string;
    subtitle?: string;
    tag?: string;
    image?: string;
    url?: string;
    accent?: string;
    publishedAt?: number;
  };
  let newsItems: NewsItem[] = [];

  async function refreshNews() {
    try {
      // @ts-ignore
      const res = await window.electronAPI?.listNews?.({ limit: 20 });
      if (res?.success) newsItems = res.news as NewsItem[];
    } catch (err) {
      console.warn("[news] refresh failed:", err);
    }
  }

  // Quick-Play servers come from the active instance's servers.dat — the
  // top 4 entries in the order the user has them in Minecraft's multiplayer
  // screen. Refreshes whenever the active instance changes.
  let quickPlayServers: { name: string; ip: string }[] = [];

  async function refreshQuickPlayServers() {
    if (!activeInstanceId) {
      quickPlayServers = [];
      return;
    }
    try {
      // @ts-ignore
      const res = await window.electronAPI?.listMultiplayerServers?.(activeInstanceId);
      if (res?.success) {
        quickPlayServers = (res.servers || []).slice(0, 4);
      }
    } catch (err) {
      console.warn("[quickplay] refresh failed:", err);
    }
  }

  $: if (activeInstanceId) refreshQuickPlayServers();
  import pkg from "../package.json";
  const version = pkg.version;

  let launching = false;
  let gameRunning = false;
  let progress = 0;

  // --- Live console / logs ---
  let logs: { time: string; text: string; level: string }[] = [];
  let latestLog = "";
  let showConsole = false;
  const MAX_LOG_LINES = 1000;

  function classifyLog(msg: string): string {
    const m = msg.toLowerCase();
    if (/(error|failed|fail|critical|invalid|exception|crash)/.test(m)) return "error";
    if (/(warn|warning)/.test(m)) return "warn";
    if (/\[debug\]/.test(m)) return "debug";
    if (/\[data\]/.test(m)) return "data";
    if (/(success|successful|up to date|synchron|installed|complete)/.test(m)) return "success";
    if (/(download|downloading|progress|%|extract|verifying|syncing)/.test(m)) return "download";
    return "info";
  }

  function pushLog(msg: string) {
    if (msg == null) return;
    const text = String(msg).replace(/\s+$/, "");
    if (!text) return;
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    logs = [...logs, { time, text, level: classifyLog(text) }];
    if (logs.length > MAX_LOG_LINES) logs = logs.slice(logs.length - MAX_LOG_LINES);
    latestLog = text;
  }

  function clearLogs() {
    logs = [];
    latestLog = "";
  }

  // --- Session playtime tracker ---
  let sessionStart = 0;
  let playtime = "00:00:00";
  let playtimeTimer: any = null;

  function startPlaytime() {
    sessionStart = Date.now();
    playtime = "00:00:00";
    if (playtimeTimer) clearInterval(playtimeTimer);
    playtimeTimer = setInterval(() => {
      const s = Math.floor((Date.now() - sessionStart) / 1000);
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      playtime = `${hh}:${mm}:${ss}`;
    }, 1000);
  }

  function stopPlaytime() {
    if (playtimeTimer) clearInterval(playtimeTimer);
    playtimeTimer = null;
  }

  // --- Instances ----------------------------------------------
  let instances: any[] = [];
  let activeInstanceId: string | null = null;
  let showInstanceModal = false;
  let showInstanceDropdown = false;
  let modPickerOpen = false;
  let pendingMod: any = null;

  // Instance detail view state (when set, we render the detail page
  // inside the Instances tab instead of the grid).
  let viewingInstanceId: string | null = null;
  let instanceDetailTab: "mods" | "resourcepacks" | "shaders" | "modpacks" = "mods";
  let instanceDraftName: string = "";
  let instanceDraftVersion: string = "";
  let detailFiles: { name: string; size: number }[] = [];
  let detailLoading = false;

  $: activeInstance = instances.find((i) => i.id === activeInstanceId) || instances[0] || null;
  $: viewingInstance = instances.find((i) => i.id === viewingInstanceId) || null;

  async function refreshInstances() {
    try {
      // @ts-ignore
      const list = await window.electronAPI?.listInstances?.();
      if (Array.isArray(list) && list.length) {
        instances = list;
        // Restore last-selected instance if it still exists
        const saved = localStorage.getItem("sorexclient_active_instance");
        if (saved && instances.find((i) => i.id === saved)) {
          activeInstanceId = saved;
        } else {
          activeInstanceId = instances[0].id;
        }
        // Sync the global selectedVersion with the active instance
        if (activeInstance?.version) selectedVersion = activeInstance.version;
      }
    } catch (err) {
      console.error("[Instances] refresh failed", err);
    }
  }

  function selectInstance(id: string) {
    activeInstanceId = id;
    localStorage.setItem("sorexclient_active_instance", id);
    showInstanceDropdown = false;
    const inst = instances.find((i) => i.id === id);
    if (inst?.version) selectedVersion = inst.version;
  }

  // --- Instance detail navigation ----------------------------
  function openInstanceDetail(id: string) {
    viewingInstanceId = id;
    instanceDetailTab = "mods";
    const inst = instances.find((i) => i.id === id);
    instanceDraftName = inst?.name || "";
    instanceDraftVersion = inst?.version || "1.20.1";
    refreshDetailFiles();
  }

  function closeInstanceDetail() {
    viewingInstanceId = null;
  }

  const SUBFOLDER_BY_TAB: Record<string, string> = {
    mods: "mods",
    resourcepacks: "resourcepacks",
    shaders: "shaderpacks",
  };

  async function refreshDetailFiles() {
    if (!viewingInstanceId) return;
    if (instanceDetailTab === "modpacks") {
      detailFiles = [];
      return;
    }
    const subfolder = SUBFOLDER_BY_TAB[instanceDetailTab];
    detailLoading = true;
    // @ts-ignore
    const res = await window.electronAPI?.listInstanceFiles?.({
      id: viewingInstanceId,
      subfolder,
    });
    detailFiles = res?.success ? res.files : [];
    detailLoading = false;
  }

  // Refresh listing whenever tab or instance changes inside the detail view
  $: if (viewingInstanceId && instanceDetailTab) refreshDetailFiles();

  async function deleteDetailFile(name: string) {
    if (!viewingInstanceId) return;
    if (!confirm(`Datei "${name}" löschen?`)) return;
    const subfolder = SUBFOLDER_BY_TAB[instanceDetailTab];
    // @ts-ignore
    await window.electronAPI?.deleteInstanceFile?.({
      id: viewingInstanceId,
      subfolder,
      name,
    });
    await refreshDetailFiles();
  }

  function openDetailFolder() {
    if (!viewingInstanceId) return;
    const subfolder = SUBFOLDER_BY_TAB[instanceDetailTab];
    // @ts-ignore
    window.electronAPI?.openInstanceFolder?.(
      subfolder ? { id: viewingInstanceId, subfolder } : viewingInstanceId,
    );
  }

  async function saveInstanceEdits() {
    if (!viewingInstanceId) return;
    // @ts-ignore
    const res = await window.electronAPI?.updateInstance?.({
      id: viewingInstanceId,
      name: instanceDraftName.trim() || viewingInstance?.name,
      version: instanceDraftVersion,
    });
    if (res?.success) {
      await refreshInstances();
      // If we just edited the active instance, sync selectedVersion too
      if (viewingInstanceId === activeInstanceId && instanceDraftVersion) {
        selectedVersion = instanceDraftVersion;
      }
    }
  }

  function formatBytes(n: number): string {
    if (!n) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function createInstance(e: CustomEvent) {
    const { name, version } = e.detail;
    // @ts-ignore
    const res = await window.electronAPI?.createInstance?.({ name, version, loader: "fabric" });
    if (res?.success) {
      await refreshInstances();
      selectInstance(res.instance.id);
      showInstanceModal = false;
    } else {
      alert("Failed to create instance: " + (res?.error || "unknown"));
    }
  }

  async function deleteInstance(id: string) {
    const tr = get(t);
    if (!confirm(tr("instances.delete"))) return;
    // @ts-ignore
    const res = await window.electronAPI?.deleteInstance?.(id);
    if (res?.success) {
      await refreshInstances();
    } else {
      alert("Failed to delete: " + (res?.error || "unknown"));
    }
  }

  function openInstanceFolder(id: string) {
    // @ts-ignore
    window.electronAPI?.openInstanceFolder?.(id);
  }

  function formatTotalPlaytime(sec: number): string {
    if (!sec) return "0m";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h >= 1) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // Pick instance flow when clicking Install on a mod
  function startModInstall(mod: any) {
    pendingMod = mod;
    if (instances.length <= 1) {
      // Only one — install directly
      doInstallMod(mod, instances[0]?.id || activeInstanceId);
    } else {
      modPickerOpen = true;
    }
  }

  async function doInstallMod(mod: any, instanceId: string | null) {
    installingModId = mod.project_id;
    // @ts-ignore
    const result = await window.electronAPI?.installMod?.({
      modId: mod.project_id,
      version: selectedVersion,
      instanceId,
    });
    if (result?.success) {
      await refreshInstalledMods();
    } else {
      alert("Failed to install: " + (result?.error || "unknown"));
    }
    installingModId = null;
    pendingMod = null;
    modPickerOpen = false;
  }

  function onModPick(e: CustomEvent) {
    const inst = e.detail;
    if (pendingMod) doInstallMod(pendingMod, inst.id);
  }
  let activeTab = "home";
  let versions: string[] = [];
  let updateInfo: any = null;
  let downloadingUpdate = false;
  let selectedVersion = "1.20.1";
  let ram = 4;

  // Multi-account store
  let accounts: any[] = [];
  let activeAccountId: string | null = null;

  // Detection for Live Preview (Iframe)
  const isLivePreview: boolean =
    typeof window !== "undefined" && window.self !== window.top;

  // Derived active user
  $: user = accounts.find((a) => a.uuid === activeAccountId) || {
    name: "Steve",
    skin: "https://minotar.net/helm/Steve/64",
    isLoggedIn: false,
    accessToken: null,
    uuid: null,
  };

  // Update Discord RPC whenever user changes
  $: if (user && user.name) {
    // @ts-ignore
    window.electronAPI?.updateRPCUser?.(user.isLoggedIn ? user.name : null);
  }

  // Main process sends the presence heartbeats for this account.
  // @ts-ignore
  $: window.electronAPI?.setPresenceUser?.(user.isLoggedIn ? { uuid: user.uuid, name: user.name } : null);

  let modSearchQuery = "";
  let modResults: any[] = [];
  let installedModFiles: string[] = [];
  let searchingMods = false;
  let installingModId: string | null = null;
  let lastAutoSearchKey = "";
  
  // Pairing System
  let showPairingModal = false;
  let pairingCode = "";
  let pairingStatus = "pending"; // pending, claimed, error
  let pairingInterval: any = null;

  async function refreshInstalledMods() {
    // @ts-ignore
    const result = await window.electronAPI?.getInstalledMods?.({
      version: selectedVersion,
      instanceId: activeInstanceId,
    });
    if (result?.success) installedModFiles = result.mods;
  }

  // Map detail tab → Modrinth project type for search/install.
  $: currentKind = instanceDetailTab === "shaders"
    ? "shader"
    : instanceDetailTab === "resourcepacks"
      ? "resourcepack"
      : instanceDetailTab === "modpacks"
        ? "modpack"
      : "mod";

  // For "is installed", mods use the per-version mods folder (installedModFiles);
  // packs/shaders use the version-agnostic folder listing (detailFiles).
  function isInstalled(mod: any) {
    if (instanceDetailTab === "modpacks") {
      return viewingInstance?.modpackProjectId === mod.project_id;
    }
    const slug = (mod.slug || "").toLowerCase();
    const title = (mod.title || "").toLowerCase().replace(/\s+/g, "-");
    const source =
      instanceDetailTab === "mods"
        ? installedModFiles
        : detailFiles.map((f) => f.name);
    return source.some((f) => {
      const fn = f.toLowerCase();
      return (
        (slug && fn.includes(slug)) ||
        (title && fn.includes(title)) ||
        (slug && slug.includes(fn.replace(/\.(jar|zip)$/, "")))
      );
    });
  }

  // Auto-fetch popular results once per instance/tab/version combination.
  $: autoSearchKey = viewingInstanceId
    ? `${viewingInstanceId}:${instanceDetailTab}:${selectedVersion}`
    : "";
  $: if (autoSearchKey && autoSearchKey !== lastAutoSearchKey) {
    lastAutoSearchKey = autoSearchKey;
    modResults = [];
    modSearchQuery = "";
    handleModSearch();
  }

  async function handleModSearch() {
    if (searchingMods) return;
    searchingMods = true;
    try {
      if (instanceDetailTab === "mods") {
        await refreshInstalledMods();
      } else {
        await refreshDetailFiles();
      }
      // @ts-ignore
      const result = await window.electronAPI?.searchMods?.({
        query: modSearchQuery,
        version: selectedVersion,
        kind: currentKind,
      });
      if (result?.success) {
        modResults = result.mods || [];
      } else {
        modResults = [];
        console.warn("[mods] search failed:", result?.error);
      }
    } catch (err) {
      console.error("[mods] handleModSearch threw:", err);
      modResults = [];
    } finally {
      searchingMods = false;
    }
  }

  async function installMod(modId: string) {
    if (instanceDetailTab === "modpacks" && !confirm(
      "Install this modpack into the current instance? Existing config and matching files may be overwritten.",
    )) return;
    installingModId = modId;
    // @ts-ignore
    const result = await window.electronAPI?.installMod?.({
      modId,
      version: selectedVersion,
      kind: currentKind,
      instanceId: viewingInstanceId || activeInstanceId,
    });
    if (result.success) {
      if (instanceDetailTab === "modpacks") {
        await refreshInstances();
        const updated = instances.find((item) => item.id === viewingInstanceId);
        if (updated?.version) {
          instanceDraftVersion = updated.version;
          if (viewingInstanceId === activeInstanceId) selectedVersion = updated.version;
        }
      } else if (instanceDetailTab === "mods") await refreshInstalledMods();
      else await refreshDetailFiles();
    } else {
      alert("Failed to install: " + result.error);
    }
    installingModId = null;
  }

  async function handleUninstall(mod: any) {
    if (instanceDetailTab === "mods") {
      // @ts-ignore
      const result = await window.electronAPI?.uninstallMod?.({
        slug: mod.slug,
        title: mod.title,
        version: selectedVersion,
        instanceId: viewingInstanceId || activeInstanceId,
      });
      if (result?.success) {
        await refreshInstalledMods();
      } else {
        alert("Failed to uninstall: " + (result?.error || "unknown"));
      }
    } else {
      // Packs/shaders: find the actual file from detailFiles and delete it directly.
      const slug = (mod.slug || "").toLowerCase();
      const title = (mod.title || "").toLowerCase().replace(/\s+/g, "-");
      const target = detailFiles.find((f) => {
        const fn = f.name.toLowerCase();
        return fn.includes(slug) || fn.includes(title);
      });
      if (target) await deleteDetailFile(target.name);
    }
  }

  onMount(async () => {
    // 1. Load versions
    // @ts-ignore
    const apiVersions = await window.electronAPI?.getVersions?.();
    const versionList = Array.isArray(apiVersions) ? apiVersions : [];
    const uniqueVersions = [
      ...new Set(versionList.map((v: { version: string }) => v.version)),
    ];
    versions = (uniqueVersions.length ? uniqueVersions : ["1.21.4", "1.20.1"]) as string[];
    if (versions.length > 0) selectedVersion = versions[0];

    // 1b. Load instances
    await refreshInstances();

    // 2. Load Settings & Accounts from LocalStorage
    const savedRam = localStorage.getItem("sorexclient_ram");
    if (savedRam) ram = parseInt(savedRam);

    const savedAccounts = localStorage.getItem("sorexclient_accounts");
    const savedActiveId = localStorage.getItem("sorexclient_active_id");

    if (savedAccounts) {
      accounts = JSON.parse(savedAccounts);
      if (savedActiveId) activeAccountId = savedActiveId;
      else if (accounts.length > 0) activeAccountId = accounts[0].uuid;
    }

    // 2b. Initial friends pull + poll every 30s while the launcher is open.
    refreshFriends();
    friendsPollTimer = setInterval(refreshFriends, 30_000);

    // 2c. News — pull at startup, refresh every 5 minutes.
    refreshNews();
    setInterval(refreshNews, 5 * 60_000);

    // 3. Listen for progress/logs from main process
    // @ts-ignore
    window.electronAPI?.onProgress?.((p) => {
      progress = Math.round(p.percent || 0);
      if (p?.type) pushLog(`${p.type}: ${progress}%`);
    });

    // @ts-ignore
    window.electronAPI?.onLog?.((msg) => {
      pushLog(msg);
    });

    // @ts-ignore
    window.electronAPI?.onGameStarted?.(() => {
      launching = false;
      gameRunning = true;
      progress = 0;
      pushLog("✓ Game window started.");
      startPlaytime();
    });

    // @ts-ignore
    window.electronAPI?.onGameClosed?.((payload) => {
      launching = false;
      gameRunning = false;
      progress = 0;
      const code = payload?.code ?? payload;
      pushLog(`Game closed${code != null ? ` (exit code ${code})` : ""}.`);
      stopPlaytime();
      refreshInstances();
    });

    // Persist the rotated Microsoft token after a pre-launch refresh so the
    // session stays valid across restarts (prevents "Invalid session").
    // @ts-ignore
    window.electronAPI?.onTokenRefreshed?.((data) => {
      if (!data?.uuid) return;
      const idx = accounts.findIndex((a) => a.uuid === data.uuid);
      if (idx === -1) return;
      accounts[idx] = {
        ...accounts[idx],
        name: data.name || accounts[idx].name,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || accounts[idx].refreshToken,
        tokenExpiry: data.tokenExpiry,
      };
      accounts = accounts; // trigger Svelte reactivity
      saveAppState();
    });

    // 4. Check for Launcher Updates
    try {
      // @ts-ignore
      const update = await window.electronAPI?.checkLauncherUpdate?.();
      if (update.updateAvailable) {
        updateInfo = update;
      }
    } catch (e) {}
  });

  async function handleLauncherUpdate() {
    if (!updateInfo) return;
    downloadingUpdate = true;
    // @ts-ignore
    await window.electronAPI.downloadLauncherUpdate(updateInfo.url);
  }

  function saveAppState() {
    localStorage.setItem("sorexclient_ram", ram.toString());
    localStorage.setItem("sorexclient_accounts", JSON.stringify(accounts));
    localStorage.setItem("sorexclient_active_id", activeAccountId || "");
  }

  function selectAccount(uuid: string) {
    activeAccountId = uuid;
    saveAppState();
  }

  function removeAccount(uuid: string) {
    accounts = accounts.filter((a) => a.uuid !== uuid);
    if (activeAccountId === uuid) {
      activeAccountId = accounts.length > 0 ? accounts[0].uuid : null;
    }
    saveAppState();
  }

  async function handleLogin() {
    // @ts-ignore
    const result = await window.electronAPI.login();
    console.log("Login result:", result);
    if (result.success) {
      const newUser = {
        name: result.profile.name,
        skin: result.profile.skin,
        isLoggedIn: true,
        accessToken: result.profile.accessToken,
        refreshToken: result.profile.refreshToken,
        tokenExpiry: result.profile.tokenExpiry,
        uuid: result.profile.uuid,
      };

      // Upsert: replace if exists, otherwise add
      const idx = accounts.findIndex((a) => a.uuid === newUser.uuid);
      if (idx !== -1) accounts[idx] = newUser;
      else accounts = [...accounts, newUser];

      activeAccountId = newUser.uuid;
      saveAppState();
    } else {
      alert("Login failed: " + result.error);
    }
  }

  async function handleLaunch(quickPlayServer: { host: string; port: number } | null = null) {
    playClick();
    if (gameRunning) {
      // @ts-ignore
      await window.electronAPI.killGame();
      return;
    }

    if (!user.isLoggedIn) {
      activeTab = "accounts";
      return;
    }
    launching = true;
    progress = 0;
    clearLogs();
    pushLog(`Starting SorexClient ${selectedVersion} (Fabric) with ${ram}GB RAM...`);
    if (activeInstance) pushLog(`Instance: ${activeInstance.name}`);
    if (quickPlayServer) {
      pushLog(`Quick-connect: ${quickPlayServer.host}:${quickPlayServer.port}`);
    }
    showConsole = true;
    // @ts-ignore
    await window.electronAPI.launchGame({
      version: selectedVersion,
      ram: ram,
      user: user,
      instanceId: activeInstanceId,
      quickPlayServer,
    });
    setTimeout(refreshInstances, 200);
  }

  // "host", "host:port" → { host, port } (default port 25565)
  function parseServerIp(raw: string): { host: string; port: number } {
    const s = (raw || "").trim();
    const idx = s.lastIndexOf(":");
    if (idx === -1) return { host: s, port: 25565 };
    const host = s.slice(0, idx);
    const port = parseInt(s.slice(idx + 1), 10);
    if (!host || isNaN(port)) return { host: s, port: 25565 };
    return { host, port };
  }

  function quickConnect(server: { name: string; ip: string }) {
    const addr = server.ip || server.name;
    if (!addr) return;
    handleLaunch(parseServerIp(addr));
  }

  async function startPairing() {
    console.log("Starting pairing for user:", user);
    if (!user.isLoggedIn || !user.accessToken) {
      alert("Please log in to your Microsoft account to use pairing.");
      return;
    }
    
    pairingStatus = "pending";
    // @ts-ignore
    const result = await window.electronAPI.generatePairingCode({...user});
    if (result.success) {
      pairingCode = result.code;
      showPairingModal = true;
      
      // Start polling
      if (pairingInterval) clearInterval(pairingInterval);
      pairingInterval = setInterval(async () => {
        // @ts-ignore
        const statusResult = await window.electronAPI.checkPairingStatus(pairingCode);
        if (statusResult.success) {
          if (statusResult.status === "claimed") {
            pairingStatus = "claimed";
            clearInterval(pairingInterval);
            setTimeout(() => {
              showPairingModal = false;
            }, 3000);
          }
        }
      }, 2000);
    } else {
      alert("Failed to generate pairing code: " + result.error);
    }
  }

  function closePairingModal() {
    showPairingModal = false;
    if (pairingInterval) clearInterval(pairingInterval);
  }
</script>

<main class="launcher">
  <div class="background" style="background-image: url('./bg.png')"></div>
  <div class="overlay"></div>
  <div class="aurora aurora-1"></div>
  <div class="aurora aurora-2"></div>
  <div class="grain"></div>

  <!-- @ts-ignore -->
  <TopBar {isLivePreview} />

  <div class="content-wrapper">
    <SidePanel bind:activeTab pendingRequests={incomingRequests.length} />

    <div class="main-content">
      {#if updateInfo}
        <div class="update-banner animate-fade-in">
          <div class="update-info">
            <span class="sparkle">âœ¨</span>
            <span class="msg"
              >New Update Available: <b>v{updateInfo.version}</b></span
            >
          </div>
          <button
            class="update-btn"
            on:click={handleLauncherUpdate}
            disabled={downloadingUpdate}
          >
            {downloadingUpdate ? "Downloading..." : "Update Now"}
          </button>
        </div>
      {/if}

      {#if activeTab === "home"}
        <div class="home-page animate-fade-in">
          <!-- LEFT: 3D hero stage with skin + play -->
          <section class="hero-col">
            <div class="hero-stage-3d">
              <div class="pixel-name" title={user.name}>{user.name}</div>
              <SkinViewer username={user.name || "Steve"} width={300} height={460} />

              <div class="floor-grid"></div>
            </div>

            <div class="hero-bottom">
              <div class="instance-pill-wrap">
                <button
                  class="instance-pill"
                  on:click={() => (showInstanceDropdown = !showInstanceDropdown)}
                  title={$t("home.activeInstance")}
                >
                  <Box size={12} />
                  <span>{activeInstance?.name || "Default"}</span>
                  <ChevronDown size={11} />
                </button>

                {#if showInstanceDropdown}
                  <div class="inst-dropdown bottom">
                    {#each instances as inst}
                      <button
                        class="inst-row"
                        class:active={inst.id === activeInstanceId}
                        on:click={() => selectInstance(inst.id)}
                      >
                        <span class="inst-row-name">{inst.name}</span>
                        <span class="inst-row-meta">{inst.version}</span>
                      </button>
                    {/each}
                    <button
                      class="inst-row create"
                      on:click={() => { showInstanceDropdown = false; showInstanceModal = true; }}
                    >
                      <Plus size={12} /> {$t("instances.new")}
                    </button>
                  </div>
                {/if}
              </div>

              <HeroPlayButton
                {launching}
                {gameRunning}
                {progress}
                version={selectedVersion}
                loader={activeInstance?.loader === "fabric" ? "Fabric" : (activeInstance?.loader || "Fabric")}
                instanceName={activeInstance?.name || "Default"}
                on:launch={handleLaunch}
                on:switch={() => (activeTab = "instances")}
              />

              <div class="quick-play">
                <span class="qp-label">{$t("home.quickPlay")}</span>
                <div class="qp-list">
                  {#if quickPlayServers.length === 0}
                    <span class="qp-empty">No multiplayer servers yet</span>
                  {:else}
                    {#each quickPlayServers as s}
                      <button
                        class="qp-item"
                        title={"Connect to " + (s.ip || s.name)}
                        on:click={() => quickConnect(s)}
                        disabled={launching || gameRunning}
                      >
                        <Server size={11} />
                        <span>{s.name}</span>
                      </button>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          </section>

          <!-- MIDDLE: Friends panel -->
          <FriendsPanel {friends} on:openFriends={() => (activeTab = "friends")} />

          <!-- RIGHT: News column -->
          <NewsPanel items={newsItems} on:viewAll={() => (activeTab = "news")} />
        </div>

        <!-- Floating console / launching status (overlays bottom of home) -->
        {#if launching || gameRunning}
          <div class="floating-status">
            <span class="status-dot {gameRunning ? 'running' : 'launching'}"></span>
            <div class="status-text">
              <span class="status-title">
                {gameRunning ? $t("play.running") : $t("play.launching")}
                {#if gameRunning}<span class="playtime">{playtime}</span>{/if}
              </span>
              <span class="status-sub">{latestLog || "Preparing game files..."}</span>
            </div>
            <button class="console-toggle" on:click={() => (showConsole = true)}>
              <Terminal size={14} /> Console
            </button>
          </div>
        {/if}
      {:else if activeTab === "accounts"}
        <div class="page animate-fade-in">
          <div class="section-header">
            <h2>Account Management</h2>
            <p>Switch between accounts or link a new one</p>
          </div>

          <div class="accounts-list scrollable">
            <div class="accounts-grid">
              {#each accounts as acc}
                <div
                  class="account-card glass"
                  class:highlight={acc.uuid === activeAccountId}
                >
                  <div class="account-info">
                    <img src={acc.skin} alt="skin" class="skin-preview" />
                    <div class="details">
                      <span class="name">{acc.name}</span>
                      <span class="type-tag">Microsoft Account</span>
                    </div>
                  </div>
                  <div class="account-actions">
                    {#if acc.uuid === activeAccountId}
                      <button class="action-btn active-state" disabled
                        >Active</button
                      >
                    {:else}
                      <button
                        class="action-btn secondary"
                        on:click={() => selectAccount(acc.uuid)}
                      >
                        Select
                      </button>
                    {/if}
                    <button
                      class="action-btn danger-icon"
                      on:click={() => removeAccount(acc.uuid)}
                      title="Remove Account"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><path d="M3 6h18" /><path
                          d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                        /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line
                          x1="10"
                          y1="11"
                          x2="10"
                          y2="17"
                        /><line x1="14" y1="11" x2="14" y2="17" /></svg
                      >
                    </button>
                  </div>
                </div>
              {/each}

              <button
                class="add-account-card glass dashed"
                on:click={handleLogin}
              >
                <div class="plus-icon">+</div>
                <span>Add Account</span>
              </button>

              <button
                class="add-account-card glass dashed pairing-card"
                on:click={startPairing}
                disabled={!user.isLoggedIn}
              >
                <div class="plus-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </div>
                <span>Pair with Web</span>
              </button>
            </div>
          </div>
        </div>
      {:else if activeTab === "security"}
        <div class="page animate-fade-in">
          <div class="section-header">
            <h2>Security & Core</h2>
            <p>
              Manage your account security and SorexShield anticheat settings.
            </p>
          </div>

          <div class="security-grid">
            <div class="security-card main glass">
              <div class="status-header">
                <div class="shield-icon pulse">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="lucide lucide-shield-check"
                    ><path
                      d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
                    /><path d="m9 12 2 2 4-4" /></svg
                  >
                </div>
                <div class="status-info">
                  <h3>SorexShield Active</h3>
                  <span class="status-tag protected">Protected by AI</span>
                </div>
              </div>
              <div class="hwid-box">
                <span
                  >HWID: <b
                    >{user.uuid
                      ? user.uuid.split("-")[0] + "-XXXX-XXXX"
                      : "NOT_LOGGED_IN"}</b
                  ></span
                >
                <button class="copy-btn">Copy ID</button>
              </div>
            </div>

            <div class="security-settings glass">
              <h3>Advanced Protection</h3>
              <div class="toggle-item">
                <div class="info">
                  <span class="label">Session Encryption</span>
                  <span class="desc">Encrypts your Minecraft session data.</span
                  >
                </div>
                <label class="switch">
                  <input type="checkbox" checked />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="toggle-item">
                <div class="info">
                  <span class="label">HWID Binding</span>
                  <span class="desc">Locks your account to this PC.</span>
                </div>
                <label class="switch">
                  <input type="checkbox" checked />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>

          <div class="security-footer glass">
            <p>
              Last integrity check: <b>Just now</b> â€¢ Status: <b>Verified</b>
            </p>
          </div>
        </div>
      {:else if activeTab === "settings"}
        <div class="page animate-fade-in">
          <div class="section-header">
            <h2>{$t("settings.title")}</h2>
            <p>{$t("settings.subtitle")}</p>
          </div>

          <div class="settings-list scrollable">
            <div class="settings-group glass">
              <h3>{$t("settings.language")}</h3>
              <div class="setting-item">
                <div class="info">
                  <span class="label">{$t("settings.language")}</span>
                  <span class="desc">{$t("settings.languageDesc")}</span>
                </div>
                <div class="control">
                  <select
                    class="lang-select"
                    bind:value={$languagePreference}
                  >
                    {#each AVAILABLE_LANGS as l}
                      <option value={l.code}>
                        {l.flag} {l.code === "auto" ? $t("settings.autoDetect") : l.label}
                      </option>
                    {/each}
                  </select>
                </div>
              </div>
            </div>

            <!-- Appearance: theme + UI mode + sounds -->
            <div class="settings-group glass">
              <h3>Appearance</h3>
              <div class="setting-item">
                <div class="info">
                  <span class="label">Theme</span>
                  <span class="desc">Accent color used across the launcher.</span>
                </div>
                <div class="control theme-swatches">
                  {#each THEMES as th}
                    <button
                      class="theme-swatch"
                      class:active={$themeStore === th.id}
                      style="--swatch:{th.swatch}"
                      title={th.label}
                      on:click={() => themeStore.set(th.id)}
                    >
                      <span class="swatch-dot"></span>
                      <span class="swatch-label">{th.label}</span>
                    </button>
                  {/each}
                </div>
              </div>

              <div class="setting-item">
                <div class="info">
                  <span class="label">Look</span>
                  <span class="desc">
                    Modern uses the glass UI. Legacy gives a classic, square launcher feel.
                  </span>
                </div>
                <div class="control">
                  <div class="seg-toggle">
                    <button
                      class:active={$uiModeStore === "modern"}
                      on:click={() => uiModeStore.set("modern")}
                    >Modern</button>
                    <button
                      class:active={$uiModeStore === "legacy"}
                      on:click={() => uiModeStore.set("legacy")}
                    >Legacy</button>
                  </div>
                </div>
              </div>

              <div class="setting-item">
                <div class="info">
                  <span class="label">Sounds</span>
                  <span class="desc">Play a click when launching the game.</span>
                </div>
                <div class="control">
                  <label class="switch">
                    <input type="checkbox" bind:checked={$soundStore} />
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <div class="settings-group glass">
              <h3>{$t("settings.performance")}</h3>
              <div class="setting-item">
                <div class="info">
                  <span class="label">{$t("settings.ramLabel")}</span>
                  <span class="desc">{$t("settings.ramDesc")}</span>
                </div>
                <div class="control">
                  <input
                    type="range"
                    min="2"
                    max="16"
                    step="1"
                    bind:value={ram}
                    on:change={saveAppState}
                  />
                  <span class="value">{ram} {$t("common.gb")}</span>
                </div>
              </div>
            </div>

            <div class="settings-group glass">
              <h3>{$t("settings.game")}</h3>
              <div class="setting-item">
                <div class="info">
                  <span class="label">{$t("settings.autoUpdate")}</span>
                  <span class="desc">{$t("settings.autoUpdateDesc")}</span>
                </div>
                <div class="control">
                  <label class="switch">
                    <input type="checkbox" checked />
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
              <div class="setting-item">
                <div class="info">
                  <span class="label">{$t("settings.logFolder")}</span>
                  <span class="desc">{$t("settings.logFolderDesc")}</span>
                </div>
                <div class="control">
                  <button
                    class="mini-btn glass"
                    on:click={() => window.electronAPI.openLogsFolder()}
                    >{$t("settings.openFolder")}</button
                  >
                </div>
              </div>
            </div>

            <div class="settings-group glass">
              <h3>{$t("settings.about")}</h3>
              <div class="setting-item">
                <div class="info">
                  <span class="label">{$t("settings.version")}</span>
                  <span class="desc">{$t("settings.versionDesc")}</span>
                </div>
                <div class="control">
                  <span class="value">v{version}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      {:else if activeTab === "skins"}
        <div class="page animate-fade-in">
          <div class="section-header">
            <h2>{$t("nav.skins")}</h2>
            <p>Preview your skin in 3D.</p>
          </div>
          <div class="skins-stage">
            <SkinViewer username={user.name || "Steve"} width={360} height={520} />
          </div>
        </div>
      {:else if activeTab === "instances"}
        {#if viewingInstanceId && viewingInstance}
          <!-- Instance detail view --------------------------------- -->
          <div class="page animate-fade-in">
            <div class="detail-header">
              <button class="back-btn" on:click={closeInstanceDetail} title="Back">
                ← {$t("instances.title")}
              </button>
              {#if viewingInstanceId === activeInstanceId}
                <span class="ic-pill">Active</span>
              {/if}
            </div>

            <div class="instance-editor card">
              <div class="editor-row">
                <label>
                  <span>Name</span>
                  <input type="text" bind:value={instanceDraftName} />
                </label>
                <label>
                  <span>Version</span>
                  <select bind:value={instanceDraftVersion}>
                    {#each (versions.length ? versions : ["1.21.4", "1.20.1"]) as v}
                      <option value={v}>{v}</option>
                    {/each}
                  </select>
                </label>
                <label>
                  <span>Loader</span>
                  <input type="text" disabled value={viewingInstance.loader || "fabric"} />
                </label>
              </div>
              <div class="editor-actions">
                <button class="ic-btn primary" on:click={saveInstanceEdits}>Save</button>
                {#if viewingInstanceId !== activeInstanceId}
                  <button class="ic-btn" on:click={() => selectInstance(viewingInstanceId!)}>
                    Set active
                  </button>
                {/if}
                <button class="ic-btn" on:click={() => openInstanceFolder(viewingInstanceId!)}>
                  <Folder size={13} /> Folder
                </button>
                <button
                  class="ic-btn danger"
                  disabled={instances.length <= 1}
                  on:click={async () => {
                    const id = viewingInstanceId!;
                    await deleteInstance(id);
                    closeInstanceDetail();
                  }}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>

            <div class="detail-tabs">
              {#if viewingInstance.modpackName}
                <span class="detail-meta">Modpack: {viewingInstance.modpackName}</span>
              {/if}
              <button
                class="detail-tab"
                class:active={instanceDetailTab === "mods"}
                on:click={() => (instanceDetailTab = "mods")}
              >
                Mods
              </button>
              <button
                class="detail-tab"
                class:active={instanceDetailTab === "resourcepacks"}
                on:click={() => (instanceDetailTab = "resourcepacks")}
              >
                Resource Packs
              </button>
              <button
                class="detail-tab"
                class:active={instanceDetailTab === "shaders"}
                on:click={() => (instanceDetailTab = "shaders")}
              >
                Shaders
              </button>
              <button
                class="detail-tab"
                class:active={instanceDetailTab === "modpacks"}
                on:click={() => (instanceDetailTab = "modpacks")}
              >
                Modpacks
              </button>
            </div>

            <div class="detail-toolbar">
              <div class="mod-search-bar glass" style="flex:1; margin-bottom:0;">
                <input
                  type="text"
                  placeholder={instanceDetailTab === "mods"
                    ? "Search mods (Sodium, Iris, JourneyMap)..."
                    : instanceDetailTab === "resourcepacks"
                      ? "Search resource packs (Faithful, Bare Bones)..."
                      : instanceDetailTab === "shaders"
                        ? "Search shaders (BSL, Complementary, Sildur's)..."
                        : "Search Modrinth modpacks (Cobblemon, Better MC)..."}
                  bind:value={modSearchQuery}
                  on:keydown={(e) => e.key === "Enter" && handleModSearch()}
                />
                <button class="search-btn" on:click={handleModSearch}>
                  {#if searchingMods}
                    <div class="mini-spinner"></div>
                  {:else}
                    Search
                  {/if}
                </button>
              </div>
              <button class="ic-btn" on:click={openDetailFolder} title="Open folder">
                <Folder size={13} />
              </button>
            </div>

            <div class="mods-container scrollable">
              {#if modResults.length > 0}
                <div class="mods-grid">
                  {#each modResults as mod}
                    <div class="mod-card glass">
                      <img src={mod.icon_url} alt={mod.title} class="mod-icon" />
                      <div class="mod-details">
                        <div class="title-row">
                          <h3>{mod.title}</h3>
                          <span class="author">by {mod.author}</span>
                        </div>
                        <p class="description">{mod.description}</p>
                        <div class="mod-footer">
                          <span class="downloads"
                            >{(mod.downloads / 1000000).toFixed(1)}M DLs</span
                          >
                          <div class="mod-actions">
                            <button
                              class="install-mod-btn"
                              class:installed={isInstalled(mod)}
                              on:click={() => instanceDetailTab === "mods" ? startModInstall(mod) : installMod(mod.project_id)}
                              disabled={installingModId === mod.project_id ||
                                isInstalled(mod)}
                            >
                              {#if installingModId === mod.project_id}
                                Installing...
                              {:else if isInstalled(mod)}
                                Installed
                              {:else}
                                Install
                              {/if}
                            </button>
                            {#if isInstalled(mod) && instanceDetailTab !== "modpacks"}
                              <button
                                class="uninstall-btn"
                                on:click={() => handleUninstall(mod)}
                                title="Uninstall"
                              >
                                <Trash2 size={14} />
                              </button>
                            {/if}
                          </div>
                        </div>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else if searchingMods}
                <div class="placeholder-view">
                  <p>Searching Modrinth...</p>
                </div>
              {:else}
                <div class="placeholder-view">
                  <h3>Nothing yet</h3>
                  <p>Hit Enter or click Search to browse Modrinth.</p>
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <!-- Instance grid --------------------------------------- -->
          <div class="page animate-fade-in">
            <div class="section-header">
              <h2>{$t("instances.title")}</h2>
              <p>{$t("instances.subtitle")}</p>
            </div>

            <div class="instances-grid scrollable">
              {#each instances as inst}
                <div
                  class="instance-card card"
                  class:active={inst.id === activeInstanceId}
                >
                  <button
                    class="ic-head ic-head-btn"
                    on:click={() => openInstanceDetail(inst.id)}
                    title="Manage instance"
                  >
                    <div class="ic-mark">{inst.name?.[0]?.toUpperCase() || "?"}</div>
                    <div class="ic-info">
                      <span class="ic-name">{inst.name}</span>
                      <span class="ic-meta">
                        {inst.version} · {inst.loader}
                      </span>
                    </div>
                    {#if inst.id === activeInstanceId}
                      <span class="ic-pill">Active</span>
                    {/if}
                  </button>

                  <div class="ic-stats">
                    <div>
                      <span class="ic-stat-label">Playtime</span>
                      <span class="ic-stat-value">
                        {formatTotalPlaytime(inst.totalPlaytimeSec || 0)}
                      </span>
                    </div>
                    <div>
                      <span class="ic-stat-label">Last played</span>
                      <span class="ic-stat-value">
                        {inst.lastPlayed
                          ? new Date(inst.lastPlayed).toLocaleDateString()
                          : "—"}
                      </span>
                    </div>
                  </div>

                  <div class="ic-actions">
                    <button
                      class="ic-btn primary"
                      on:click={() => openInstanceDetail(inst.id)}
                    >
                      Manage
                    </button>
                    {#if inst.id !== activeInstanceId}
                      <button
                        class="ic-btn"
                        on:click={() => selectInstance(inst.id)}
                      >
                        Select
                      </button>
                    {/if}
                    <button
                      class="ic-btn"
                      title="Open folder"
                      on:click={() => openInstanceFolder(inst.id)}
                    >
                      <Folder size={13} />
                    </button>
                    <button
                      class="ic-btn danger"
                      title="Delete"
                      disabled={instances.length <= 1}
                      on:click={() => deleteInstance(inst.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              {/each}

              <button
                class="instance-card create-card"
                on:click={() => (showInstanceModal = true)}
              >
                <Plus size={22} />
                <span>New instance</span>
              </button>
            </div>
          </div>
        {/if}
      {:else if activeTab === "news"}
        <div class="page animate-fade-in news-page">
          <div class="section-header">
            <h2>{$t("news.title")}</h2>
            <p>Latest updates, events, and announcements.</p>
          </div>

          <div class="news-grid scrollable">
            {#each newsItems as it}
              <article
                class="news-card card"
                style={it.accent ? `background: ${it.accent}` : ""}
                role={it.url ? "button" : undefined}
                tabindex={it.url ? 0 : undefined}
                on:click={() => it.url && window.open(it.url, "_blank")}
                on:keydown={(e) => { if ((e.key === "Enter" || e.key === " ") && it.url) window.open(it.url, "_blank"); }}
              >
                {#if it.image}
                  <div class="news-image">
                    <img src={it.image} alt="" />
                    <div class="news-scrim"></div>
                  </div>
                {/if}
                <div class="news-body">
                  {#if it.tag}<span class="news-tag">{it.tag}</span>{/if}
                  <h3>{it.title}</h3>
                  {#if it.subtitle}<p>{it.subtitle}</p>{/if}
                </div>
              </article>
            {/each}
          </div>
        </div>
      {:else if activeTab === "friends"}
        <div class="page animate-fade-in friends-page">
          <div class="section-header">
            <h2>{$t("nav.friends")}</h2>
            <p>Add friends, accept requests, and chat.</p>
          </div>

          <div class="add-friend-row card">
            <input
              type="text"
              placeholder="Add friend by Minecraft username..."
              bind:value={addFriendName}
              on:keydown={(e) => e.key === "Enter" && handleAddFriend()}
              disabled={addFriendBusy || !activeAccountId}
            />
            <button
              class="ic-btn primary"
              on:click={handleAddFriend}
              disabled={addFriendBusy || !addFriendName.trim() || !activeAccountId}
            >
              {addFriendBusy ? "Sending..." : "Send request"}
            </button>
          </div>
          {#if addFriendError}
            <p class="add-friend-error">{addFriendError}</p>
          {/if}
          {#if !activeAccountId}
            <p class="add-friend-error">Log in with a Microsoft account first.</p>
          {/if}

          <div class="friends-layout">
            <!-- LEFT: requests + friend list -->
            <aside class="friends-side card scrollable">
              {#if incomingRequests.length > 0}
                <h3 class="side-section-label">Incoming ({incomingRequests.length})</h3>
                {#each incomingRequests as req}
                  <div class="req-row">
                    <img
                      class="req-avatar"
                      src="https://minotar.net/avatar/{encodeURIComponent(req.from?.name || '?')}/28"
                      alt={req.from?.name || ''}
                    />
                    <span class="req-name">{req.from?.name || 'Unknown'}</span>
                    <button class="req-btn accept" title="Accept" on:click={() => acceptRequest(req)}>✓</button>
                    <button class="req-btn reject" title="Reject" on:click={() => rejectRequest(req)}>✕</button>
                  </div>
                {/each}
              {/if}

              {#if outgoingRequests.length > 0}
                <h3 class="side-section-label muted">Sent ({outgoingRequests.length})</h3>
                {#each outgoingRequests as req}
                  <div class="req-row dim">
                    <img
                      class="req-avatar"
                      src="https://minotar.net/avatar/{encodeURIComponent(req.to?.name || '?')}/28"
                      alt={req.to?.name || ''}
                    />
                    <span class="req-name">{req.to?.name || 'Unknown'}</span>
                    <span class="req-pending">Pending</span>
                  </div>
                {/each}
              {/if}

              <h3 class="side-section-label">Friends ({friends.length})</h3>
              {#if friends.length === 0}
                <p class="side-empty">No friends yet. Add one above.</p>
              {:else}
                {#each friends as f}
                  <button
                    class="friend-row"
                    class:active={selectedChatPeer?.uuid && selectedChatPeer.uuid === f.uuid}
                    on:click={() => openChat(f)}
                    disabled={!f.uuid}
                  >
                    <div class="friend-avatar">
                      <img src={headUrl(f.name)} alt={f.name} />
                      <span class="dot" class:online={f.online}></span>
                    </div>
                    <div class="friend-meta">
                      <span class="friend-name">{f.name}</span>
                      <span class="friend-sub">{presenceText(f, $t)}</span>
                    </div>
                  </button>
                {/each}
              {/if}
            </aside>

            <!-- RIGHT: chat -->
            <section class="chat-pane card">
              {#if !selectedChatPeer}
                <div class="chat-empty">
                  <h3>No chat selected</h3>
                  <p>Pick a friend from the list to start chatting.</p>
                </div>
              {:else}
                <header class="chat-header">
                  <div class="friend-avatar">
                    <img src={headUrl(selectedChatPeer.name)} alt={selectedChatPeer.name} />
                    <span class="dot" class:online={selectedChatPeer.online}></span>
                  </div>
                  <div class="chat-header-meta">
                    <span class="chat-name">{selectedChatPeer.name}</span>
                    <span class="chat-status" class:online={selectedChatPeer.online}>
                      {presenceText(selectedChatPeer, $t)}
                    </span>
                  </div>
                  <button class="chat-close" on:click={closeChat} title="Close">✕</button>
                </header>

                <div class="chat-body scrollable" bind:this={chatBodyEl}>
                  {#if chatMessages.length === 0}
                    <p class="chat-placeholder">No messages yet — say hi 👋</p>
                  {:else}
                    {#each chatMessages as m, i (m.id)}
                      {@const mine = plainUuid(m.from) === myPlainUuid}
                      {@const author = mine ? user.name : selectedChatPeer.name}
                      <!-- Head + name only on the first message of a run from the same sender. -->
                      {@const first = i === 0 || plainUuid(chatMessages[i - 1].from) !== plainUuid(m.from)}
                      <div class="chat-msg" class:me={mine} class:first>
                        {#if first}
                          <img class="chat-head" src={headUrl(author)} alt={author} />
                        {/if}
                        <div class="chat-content">
                          {#if first}<span class="chat-author">{author}</span>{/if}
                          <div class="chat-bubble">{m.body}</div>
                          <span class="chat-time">{formatChatTime(m.sentAt)}</span>
                        </div>
                      </div>
                    {/each}
                  {/if}
                </div>

                <div class="chat-input">
                  <input
                    type="text"
                    placeholder="Type a message..."
                    bind:value={chatDraft}
                    on:keydown={(e) => e.key === "Enter" && sendChatMessage()}
                    disabled={chatSending}
                  />
                  <button
                    class="ic-btn primary"
                    on:click={sendChatMessage}
                    disabled={chatSending || !chatDraft.trim()}
                  >Send</button>
                </div>
              {/if}
            </section>
          </div>
        </div>
      {/if}
    </div>

    {#if activeTab === "home"}
      <button
        class="profile-section glass"
        on:click={() => (activeTab = "accounts")}
        title="Account Settings"
      >
        <div class="avatar">
          <img src={user.skin} alt={user.name} />
        </div>
        <div class="status-indicator" class:online={user.isLoggedIn}></div>
      </button>
    {/if}

    <Console
      open={showConsole}
      {logs}
      {gameRunning}
      {launching}
      on:close={() => (showConsole = false)}
      on:clear={clearLogs}
      on:openFolder={() => window.electronAPI?.openLogsFolder?.()}
    />

    <InstanceModal
      open={showInstanceModal}
      versions={versions.length ? versions : ["1.21.4", "1.20.1"]}
      on:close={() => (showInstanceModal = false)}
      on:create={createInstance}
    />

    <InstancePicker
      open={modPickerOpen}
      mod={pendingMod}
      {instances}
      {activeInstanceId}
      on:close={() => { modPickerOpen = false; pendingMod = null; }}
      on:pick={onModPick}
    />

    {#if showPairingModal}
      <div class="modal-overlay animate-fade-in" on:click={closePairingModal}>
        <div class="pairing-modal glass" on:click|stopPropagation>
          <button class="close-modal" on:click={closePairingModal}>&times;</button>
          
          {#if pairingStatus === "pending"}
            <div class="pairing-content">
              <h2>Pair with Web Portal</h2>
              <p>Enter this code on the website to log in instantly.</p>
              
              <div class="code-display">
                {pairingCode}
              </div>
              
              <div class="waiting-status">
                <div class="mini-spinner"></div>
                <span>Waiting for pairing...</span>
              </div>
            </div>
          {:else if pairingStatus === "claimed"}
            <div class="pairing-content success">
              <div class="success-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </div>
              <h2>Pairing Successful!</h2>
              <p>You are now logged into the Web Portal.</p>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</main>

<style>
  .launcher {
    width: 100vw;
    height: 100vh;
    border-radius: var(--r-md);
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }

  /* Aurora/grain layers retained in markup but neutralised for the flat design */
  .aurora,
  .grain {
    display: none;
  }

  input {
    user-select: text;
    -webkit-user-select: text;
  }

  .background {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    z-index: -2;
    filter: brightness(0.32) saturate(0.85);
  }

  .overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(11, 11, 13, 0.72) 0%, rgba(11, 11, 13, 0.92) 100%);
    z-index: -1;
  }

  .content-wrapper {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }

  /* Mod Browser Styles */
  .mod-search-bar {
    display: flex;
    padding: 8px;
    border-radius: 8px;
    margin-bottom: 24px;
    gap: 8px;
  }

  .mod-search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    padding: 12px 16px;
    color: white;
    font-size: 15px;
    outline: none;
  }

  .search-btn {
    padding: 0 24px;
    background: var(--accent);
    color: var(--accent-contrast, #0b0b0d);
    border-radius: 6px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    transition: 0.2s;
  }

  .search-btn:hover {
    background: var(--primary-hover);
  }

  .mods-container {
    flex: 1;
  }

  .mods-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .mod-card {
    display: flex;
    padding: 20px;
    border-radius: 8px;
    gap: 20px;
    transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .mod-card:hover {
    transform: translateX(4px);
    background: rgba(255, 255, 255, 0.05);
  }

  .mod-icon {
    width: 64px;
    height: 64px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.2);
  }

  .mod-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mod-details h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .author {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.3);
  }

  .description {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .mod-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }

  .mod-actions {
    display: flex;
    gap: 8px;
  }

  .uninstall-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: 0.2s;
  }

  .uninstall-btn:hover {
    background: #ef4444;
    color: white;
  }

  .downloads {
    font-size: 12px;
    font-weight: 700;
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
    padding: 4px 10px;
    border-radius: 8px;
  }

  .install-mod-btn {
    padding: 8px 16px;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 6px;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    transition: 0.2s;
  }

  .install-mod-btn.installed {
    background: rgba(16, 185, 129, 0.2) !important;
    color: #10b981 !important;
    border-color: rgba(16, 185, 129, 0.5) !important;
    cursor: default;
    opacity: 1 !important;
  }

  .install-mod-btn:hover:not(:disabled):not(.installed) {
    background: var(--accent);
    color: var(--accent-contrast, #0b0b0d);
  }

  .placeholder-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgba(255, 255, 255, 0.3);
    text-align: center;
  }

  .icon-orb {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .mini-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .main-content {
    flex: 1;
    padding: 18px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .section-header h2 {
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.4px;
    margin-bottom: 3px;
    color: var(--text);
  }

  .section-header p {
    color: var(--text-dim);
    font-size: 13px;
    margin-bottom: 24px;
  }

  .accounts-list {
    flex: 1;
    overflow-y: auto;
    padding-right: 12px;
  }

  .accounts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .account-card {
    padding: 20px;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition: all 0.3s ease;
  }

  .account-card.highlight {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow: 0 0 30px transparent;
  }

  .account-actions {
    display: flex;
    gap: 10px;
    margin-top: auto;
  }

  .action-btn.active-state {
    background: var(--accent);
    color: var(--accent-contrast, #0b0b0d);
    flex: 1;
    opacity: 1;
  }

  .danger-icon {
    width: 44px;
    height: 44px;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .danger-icon:hover {
    background: #ef4444;
    color: white;
  }

  /* Add Account Card */
  .add-account-card {
    border-radius: 8px;
    height: 160px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.4);
    transition: all 0.3s;
    background: transparent;
  }

  .add-account-card.dashed {
    border: 2px dashed rgba(255, 255, 255, 0.1);
  }

  .add-account-card:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }

  .plus-icon {
    font-size: 32px;
    font-weight: 300;
  }

  .account-info {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .skin-preview {
    width: 52px;
    height: 52px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
    padding: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .details .name {
    display: block;
    font-size: 16px;
    font-weight: 700;
  }

  .type-tag {
    font-size: 11px;
    color: rgba(255,255,255,0.85);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .action-btn {
    padding: 10px;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    flex: 1;
  }

  /* Custom Scrollbar */
  .scrollable {
    overflow-y: auto;
    padding-right: 8px;
  }

  .scrollable::-webkit-scrollbar {
    width: 6px;
  }
  .scrollable::-webkit-scrollbar-track {
    background: transparent;
  }
  .scrollable::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
  }
  .scrollable::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .glass {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .details .name {
    display: block;
    font-size: 18px;
    font-weight: 700;
  }

  .type-tag {
    font-size: 12px;
    color: rgba(255,255,255,0.85);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .action-btn {
    padding: 12px;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .secondary {
    background: rgba(255, 255, 255, 0.05);
    color: white;
  }

  /* Settings View */
  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow-y: auto;
    padding-right: 8px;
  }

  .settings-group {
    padding: 24px;
    border-radius: 8px;
  }

  .settings-group h3 {
    font-size: 14px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: rgba(255, 255, 255, 0.3);
    margin-bottom: 20px;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .setting-item:last-child {
    border: none;
    padding-bottom: 0;
  }

  .setting-item .label {
    display: block;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .setting-item .desc {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
  }

  .control {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .value {
    font-weight: 700;
    color: rgba(255,255,255,0.85);
    min-width: 50px;
    text-align: right;
  }

  /* Custom Range Input */
  input[type="range"] {
    -webkit-appearance: none;
    width: 150px;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    outline: none;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    background: rgba(255,255,255,0.85);
    border-radius: 50%;
    cursor: pointer;
    box-shadow: none;
  }

  /* Custom Switch */
  .switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.1);
    transition: 0.4s;
    border-radius: 8px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.4s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: var(--accent);
  }

  input:checked + .slider:before {
    transform: translateX(20px);
  }

  .mini-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .welcome-section {
    margin-bottom: 28px;
  }

  .welcome-section h1 {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 600;
    margin-bottom: 6px;
    letter-spacing: -0.6px;
    line-height: 1.1;
    color: var(--text);
  }

  .username {
    color: var(--text);
    font-weight: 600;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .version-tag {
    font-size: 10px;
    background: var(--surface);
    color: var(--text-muted);
    padding: 2px 7px;
    border-radius: var(--r-xs);
    font-weight: 500;
    letter-spacing: 0.2px;
    border: 1px solid var(--border);
    font-family: var(--font-mono);
  }

  .news-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .news-card {
    position: relative;
    padding: 18px 20px;
    border-radius: var(--r-md);
    display: flex;
    flex-direction: column;
    gap: 10px;
    cursor: pointer;
    overflow: hidden;
    transition: background 0.18s var(--ease), border-color 0.18s var(--ease);
  }

  .news-card::before { display: none; }

  .news-card:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
  }

  .news-tag {
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 600;
    padding: 2px 7px;
    background: var(--surface-active);
    color: var(--text-muted);
    width: fit-content;
    border-radius: var(--r-xs);
    letter-spacing: 0.6px;
    border: 1px solid var(--border);
  }

  .news-tag.event {
    background: var(--surface-active);
    color: var(--text-muted);
  }

  .news-card h3 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 15px;
    letter-spacing: -0.2px;
  }

  .news-card p {
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .bottom-tray {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding-bottom: 20px;
  }

  .launch-status {
    width: 100%;
    max-width: 580px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 10px 14px;
    border-radius: var(--r-md);
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.launching {
    background: #d4a557;
    animation: pulse-dot 1.4s infinite;
  }

  .status-dot.running {
    background: #4caf50;
  }

  @keyframes pulse-dot { 50% { opacity: 0.45; } }

  .status-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .status-title {
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }

  .playtime {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 0 6px;
    border-radius: var(--r-xs);
  }

  .status-sub {
    font-size: 11.5px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 360px;
    font-family: var(--font-mono);
  }

  .console-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: var(--r-sm);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }

  .console-toggle:hover {
    color: var(--text);
    background: var(--surface-hover);
    border-color: var(--border-strong);
  }

  .progress-track {
    width: 100%;
    max-width: 580px;
    height: 2px;
    background: var(--border);
    border-radius: 1px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s var(--ease);
  }

  .tray-actions {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .ghost-btn {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: var(--r-md);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    transition: all 0.18s var(--ease);
  }

  .ghost-btn:hover {
    color: var(--text);
    background: var(--surface-hover);
    border-color: var(--border-strong);
  }

  .log-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: #0b0b0d;
    font-size: 9.5px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .profile-section {
    position: absolute;
    bottom: 24px;
    right: 24px;
    padding: 8px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 100;
  }

  .profile-section {
    border-radius: var(--r-md);
  }

  .profile-section:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
  }

  .avatar {
    width: 40px;
    height: 40px;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border);
  }

  .avatar img {
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  .status-indicator {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px solid var(--bg);
    position: absolute;
    bottom: 5px;
    left: 32px;
  }

  .status-indicator.online {
    background: #4caf50;
  }

  .status-indicator:not(.online) {
    background: rgba(255, 255, 255, 0.25);
  }
  /* Update Banner */
  .update-banner {
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    margin-bottom: 20px;
    padding: 10px 16px;
    border-radius: var(--r-md);
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 50;
  }

  .update-info {
    display: flex;
    align-items: center;
    gap: 12px;
    color: white;
  }

  .update-btn {
    background: var(--accent);
    color: #0b0b0d;
    border: none;
    padding: 6px 14px;
    border-radius: var(--r-sm);
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    transition: opacity 0.18s var(--ease);
  }

  .update-btn:hover:not(:disabled) {
    opacity: 0.88;
  }

  .update-btn:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .sparkle {
    font-size: 20px;
  }
  /* Security Page Styles */
  .security-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 24px;
  }

  .security-card.main {
    padding: 32px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.05) 0%,
      rgba(255, 255, 255, 0.04) 100%
    );
  }

  .status-header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 32px;
  }

  .shield-icon {
    width: 64px;
    height: 64px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .pulse {
    animation: shield-pulse 2s infinite;
  }

  @keyframes shield-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.18);
    }
    70% {
      box-shadow: 0 0 0 15px rgba(255, 255, 255, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
    }
  }

  .status-tag.protected {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
    padding: 4px 12px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .hwid-box {
    background: rgba(0, 0, 0, 0.2);
    padding: 16px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: monospace;
    font-size: 13px;
    color: var(--text-muted);
  }

  .copy-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
  }

  .security-settings {
    padding: 24px;
  }

  .security-footer {
    padding: 16px 24px;
    font-size: 13px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
  }

  .security-footer b {
    color: #10b981;
    margin: 0 4px;
  }

  .toggle-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .toggle-item:last-child {
    border-bottom: none;
  }

  /* Pairing Modal Styles */
  .modal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .pairing-modal {
    width: 400px;
    padding: 40px;
    border-radius: 8px;
    text-align: center;
    position: relative;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    background: rgba(15, 15, 20, 0.8);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .close-modal {
    position: absolute;
    top: 20px;
    right: 20px;
    background: transparent;
    border: none;
    color: white;
    font-size: 24px;
    cursor: pointer;
    opacity: 0.5;
    transition: 0.2s;
  }

  .close-modal:hover {
    opacity: 1;
  }

  .pairing-content h2 {
    margin: 0 0 10px 0;
    font-size: 24px;
    background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .pairing-content p {
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 30px;
  }

  .code-display {
    font-size: 48px;
    font-weight: 800;
    letter-spacing: 4px;
    color: rgba(255,255,255,0.85);
    background: rgba(255, 255, 255, 0.05);
    padding: 20px;
    border-radius: 8px;
    border: 1px dashed rgba(255, 255, 255, 0.18);
    margin-bottom: 30px;
    font-family: 'Monaco', 'Consolas', monospace;
  }

  .waiting-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 14px;
  }

  .pairing-content.success {
    animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .success-icon {
    width: 80px;
    height: 80px;
    background: rgba(16, 185, 129, 0.1);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
  }

  .pairing-card:disabled {
    opacity: 0.3;
    cursor: not-allowed;
    filter: grayscale(1);
  }

  @keyframes scaleIn {
    from { transform: scale(0.8); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  /* ============= Hero 3D Stage ============= */
  .hero-stage {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 24px;
    margin-top: 8px;
    perspective: 1200px;
  }

  .skin-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-md);
    background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01));
    border: 1px solid var(--border);
    padding: 10px;
    position: relative;
    overflow: hidden;
    /* Subtle 3D plane — tilts slightly into the page */
    transform: rotateY(-2deg) rotateX(2deg);
  }

  .skin-cell::after {
    /* Floor highlight to suggest a 3D stage */
    content: "";
    position: absolute;
    inset: auto 0 0 0;
    height: 40%;
    background: radial-gradient(ellipse at 50% 100%, rgba(255,255,255,0.04), transparent 60%);
    pointer-events: none;
  }

  .hero-side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  /* Generic small card */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }

  .stat-card { padding: 12px 14px; position: relative; }

  .card-head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px;
  }
  .head-left { display: flex; align-items: center; gap: 8px; }
  .icon-square {
    width: 22px; height: 22px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted);
  }
  .label { font-size: 11px; color: var(--text-muted); font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.4px; }
  .link-btn {
    font-size: 11px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: var(--r-xs);
  }
  .link-btn:hover { background: var(--surface-hover); color: var(--text); }

  .instance-switch {
    width: 100%;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    transition: background 0.18s var(--ease);
  }
  .instance-switch:hover { background: var(--surface-hover); }

  .inst-mark {
    width: 28px; height: 28px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    font-weight: 600; font-size: 12px; color: var(--text);
  }
  .inst-info { flex: 1; display: flex; flex-direction: column; min-width: 0; text-align: left; }
  .inst-name { font-size: 13px; font-weight: 500; }
  .inst-meta { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }

  .inst-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 14px;
    right: 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    padding: 4px;
    z-index: 50;
    display: flex; flex-direction: column; gap: 2px;
    box-shadow: 0 12px 30px rgba(0,0,0,0.4);
  }
  .inst-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 10px;
    border-radius: var(--r-xs);
    color: var(--text);
    font-size: 12.5px;
    text-align: left;
  }
  .inst-row:hover { background: var(--surface-hover); }
  .inst-row.active { background: var(--accent-soft); color: var(--accent); }
  .inst-row.create { color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 7px; margin-top: 2px; gap: 6px; }
  .inst-row.create:hover { color: var(--text); }
  .inst-row-name { font-weight: 500; }
  .inst-row-meta { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }

  .stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .stat-tile {
    padding: 10px 12px;
    display: flex; align-items: center; gap: 10px;
  }
  .tile-icon {
    width: 28px; height: 28px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .tile-content { display: flex; flex-direction: column; min-width: 0; }
  .tile-label { font-size: 10.5px; color: var(--text-dim); text-transform: uppercase;
    letter-spacing: 0.4px; font-weight: 500; }
  .tile-value { font-size: 14px; font-weight: 600; color: var(--text); }

  .news-card-mini {
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 6px;
    cursor: pointer;
    transition: background 0.18s var(--ease);
  }
  .news-card-mini:hover { background: var(--surface-hover); }
  .news-card-mini h3 { font-size: 13px; font-weight: 600; }
  .news-card-mini p { font-size: 11.5px; color: var(--text-muted); line-height: 1.4; }
  .news-card-mini .news-tag {
    width: fit-content;
    font-size: 9.5px;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    border: 1px solid var(--border);
    color: var(--text-muted);
    text-transform: uppercase;
    font-weight: 600;
  }

  /* ============= Instances grid ============= */
  .instances-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .instance-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: background 0.18s var(--ease), border-color 0.18s var(--ease);
  }
  .instance-card:hover { background: var(--surface-hover); border-color: var(--border-strong); }
  .instance-card.active { border-color: var(--accent); background: var(--accent-soft); }
  .ic-head { display: flex; align-items: center; gap: 10px; }
  .ic-mark {
    width: 36px; height: 36px;
    border-radius: var(--r-sm);
    background: var(--surface-active);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    font-weight: 600; font-size: 14px; color: var(--text);
  }
  .ic-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .ic-name { font-size: 14px; font-weight: 600; }
  .ic-meta { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }
  .ic-pill {
    font-size: 9.5px;
    padding: 2px 6px;
    border-radius: var(--r-xs);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .ic-stats {
    display: flex;
    gap: 16px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .ic-stats > div { display: flex; flex-direction: column; gap: 2px; }
  .ic-stat-label {
    font-size: 10px; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.4px; font-weight: 500;
  }
  .ic-stat-value { font-size: 12.5px; color: var(--text); font-weight: 500; }
  .ic-actions { display: flex; gap: 6px; }
  .ic-btn {
    padding: 6px 12px;
    border-radius: var(--r-sm);
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .ic-btn:hover:not(:disabled) { background: var(--surface-hover); }
  .ic-btn.primary {
    background: var(--accent);
    color: var(--accent-contrast, #0b0b0d);
    border-color: var(--accent);
    flex: 1;
    font-weight: 600;
  }
  .ic-btn.primary:hover:not(:disabled) {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
  }
  .ic-btn.primary:disabled {
    background: var(--surface-active);
    color: var(--text-muted);
    cursor: not-allowed;
  }
  .ic-btn.danger:hover:not(:disabled) {
    background: rgba(211, 59, 59, 0.15);
    border-color: rgba(211, 59, 59, 0.4);
    color: #e07070;
  }
  .ic-btn.danger:disabled { opacity: 0.4; cursor: not-allowed; }

  .create-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    background: transparent;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
    gap: 8px;
    padding: 24px;
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 500;
    min-height: 140px;
  }
  .create-card:hover { background: var(--surface); color: var(--text); border-color: var(--text-dim); }

  /* ============= Instance manage button on grid ============= */
  .ic-head-btn {
    background: transparent;
    border: none;
    width: 100%;
    text-align: left;
    cursor: pointer;
    padding: 0;
    color: inherit;
    font: inherit;
  }
  .ic-head-btn:hover .ic-name { text-decoration: underline; }

  /* ============= Instance Detail View ============= */
  .detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .back-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--r-sm);
    padding: 6px 12px;
    font-size: 12.5px;
    cursor: pointer;
    transition: all 0.18s var(--ease);
  }
  .back-btn:hover { background: var(--surface-hover); color: var(--text); border-color: var(--border-strong); }

  .instance-editor {
    padding: 16px;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .editor-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 12px;
  }
  .editor-row label {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .editor-row label span {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .editor-row input,
  .editor-row select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 10px;
    border-radius: var(--r-sm);
    font-family: inherit;
    font-size: 13px;
    outline: none;
  }
  .editor-row input:focus,
  .editor-row select:focus { border-color: var(--border-strong); }
  .editor-row input:disabled {
    color: var(--text-dim);
    cursor: not-allowed;
  }
  .editor-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .detail-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 14px;
  }
  .detail-tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dim);
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.18s var(--ease);
  }
  .detail-tab:hover { color: var(--text); }
  .detail-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .detail-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .detail-meta {
    color: var(--text-dim);
    font-size: 12px;
    margin-left: auto;
    font-family: var(--font-mono);
  }

  .file-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
  }
  .file-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .file-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-meta {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  /* ============= Theme swatches + segmented toggle ============= */
  .theme-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .theme-swatch {
    --swatch: var(--accent);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 8px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.18s var(--ease);
  }
  .theme-swatch:hover { background: var(--surface-hover); color: var(--text); }
  .theme-swatch.active {
    background: var(--surface-active);
    border-color: var(--swatch);
    color: var(--text);
  }
  .swatch-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4);
  }

  .seg-toggle {
    display: inline-flex;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 2px;
    gap: 2px;
  }
  .seg-toggle button {
    background: transparent;
    border: none;
    color: var(--text-muted);
    padding: 5px 12px;
    border-radius: var(--r-xs);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s var(--ease);
  }
  .seg-toggle button:hover { color: var(--text); }
  .seg-toggle button.active {
    background: var(--surface-active);
    color: var(--text);
  }

  /* ============= Friends page ============= */
  .friends-page {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .add-friend-row {
    display: flex;
    gap: 8px;
    padding: 10px;
    margin-bottom: 8px;
  }
  .add-friend-row input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text);
    padding: 8px 12px;
    font-size: 13px;
    outline: none;
    font-family: inherit;
  }
  .add-friend-error {
    color: #e07070;
    font-size: 12px;
    margin: 4px 4px 8px;
  }

  .friends-layout {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(260px, 320px) 1fr;
    gap: 12px;
    min-height: 0;
  }

  .friends-side {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
  }
  .side-section-label {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted);
    margin: 6px 4px 2px;
  }
  .side-section-label.muted { color: var(--text-dim); }
  .side-empty {
    font-size: 12px;
    color: var(--text-dim);
    padding: 8px 4px;
  }

  .req-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  .req-row.dim { opacity: 0.7; }
  .req-avatar {
    width: 24px; height: 24px;
    border-radius: var(--r-xs);
    image-rendering: pixelated;
  }
  .req-name { flex: 1; font-size: 13px; font-weight: 500; }
  .req-pending {
    font-size: 10.5px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .req-btn {
    width: 24px; height: 24px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
  }
  .req-btn.accept:hover { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
  .req-btn.reject:hover { background: rgba(211, 59, 59, 0.18); color: #e07070; border-color: rgba(211, 59, 59, 0.5); }

  .friend-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: var(--r-sm);
    background: transparent;
    border: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: var(--text);
    transition: background 0.15s var(--ease);
  }
  .friend-row:hover { background: var(--surface-hover); }
  .friend-row.active { background: var(--accent-soft); }
  .friend-row:disabled { opacity: 0.5; cursor: not-allowed; }
  .friend-avatar {
    position: relative;
    width: 28px; height: 28px;
  }
  .friend-avatar img {
    width: 100%; height: 100%;
    border-radius: var(--r-xs);
    image-rendering: pixelated;
  }
  .friend-avatar .dot {
    position: absolute;
    bottom: -2px; right: -2px;
    width: 9px; height: 9px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid var(--bg);
  }
  .friend-avatar .dot.online { background: #5ab06a; }
  .friend-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .friend-name { font-size: 13px; font-weight: 600; }
  .friend-sub {
    font-size: 11px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .chat-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    gap: 6px;
  }
  .chat-empty h3 { color: var(--text); font-size: 15px; font-weight: 600; }
  .chat-empty p { font-size: 12.5px; }

  .chat-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .chat-header img {
    width: 28px; height: 28px;
    border-radius: var(--r-xs);
    image-rendering: pixelated;
  }
  .chat-header-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .chat-name { font-size: 13.5px; font-weight: 600; }
  .chat-status { font-size: 11px; color: var(--text-dim); }
  .chat-status.online { color: #5ab06a; }
  .chat-close {
    background: transparent;
    border: none;
    color: var(--text-dim);
    width: 26px; height: 26px;
    border-radius: var(--r-xs);
    cursor: pointer;
  }
  .chat-close:hover { background: var(--surface-hover); color: var(--text); }

  .chat-body {
    flex: 1;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .chat-placeholder { color: var(--text-dim); font-size: 12.5px; text-align: center; margin: auto; }

  /* Friend on the left, me on the right. Follow-up messages indent past the head. */
  .chat-msg {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: 75%;
    padding-left: 40px;
  }
  .chat-msg.first { padding-left: 0; margin-top: 10px; }
  .chat-msg.first:first-child { margin-top: 0; }
  .chat-msg.me {
    align-self: flex-end;
    flex-direction: row-reverse;
    padding-left: 0;
    padding-right: 40px;
  }
  .chat-msg.me.first { padding-right: 0; }
  .chat-head {
    width: 32px; height: 32px;
    border-radius: var(--r-xs);
    image-rendering: pixelated;
    flex-shrink: 0;
  }
  .chat-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
  }
  .chat-msg.me .chat-content { align-items: flex-end; }
  .chat-author { font-size: 11.5px; font-weight: 600; color: var(--text-muted); }
  .chat-bubble {
    background: var(--surface-active);
    color: var(--text);
    padding: 7px 12px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .chat-msg.first .chat-bubble { border-top-left-radius: 4px; }
  .chat-msg.me .chat-bubble {
    background: var(--accent);
    color: var(--accent-contrast, #0b0b0d);
  }
  .chat-msg.me.first .chat-bubble { border-top-left-radius: 14px; border-top-right-radius: 4px; }
  .chat-time {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .chat-input {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
  .chat-input input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text);
    padding: 8px 12px;
    font-size: 13px;
    outline: none;
    font-family: inherit;
  }

  /* ============= News page ============= */
  .news-page { overflow: hidden; }
  .news-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
    padding-right: 4px;
    overflow-y: auto;
  }
  .news-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: transform 0.18s var(--ease), border-color 0.18s var(--ease);
  }
  .news-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-strong);
  }
  .news-image {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
  }
  .news-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .news-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.05) 0%, rgba(0, 0, 0, 0.45) 100%);
  }
  .news-body {
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .news-tag {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    padding: 2px 7px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    color: var(--text-muted);
    width: fit-content;
  }
  .news-body h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.2px;
  }
  .news-body p {
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.45;
  }

  /* ============= NEW Home 3-column layout ============= */
  .home-page {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(360px, 1.6fr) minmax(220px, 1fr) minmax(220px, 1fr);
    gap: 14px;
    min-height: 0;
    overflow: hidden;
  }

  /* Hero column ----------------------------------------- */
  .hero-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 14px;
  }

  .hero-stage-3d {
    position: relative;
    flex: 1;
    min-height: 0;
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: radial-gradient(
      ellipse at 50% 35%,
      rgba(255, 255, 255, 0.06) 0%,
      rgba(11, 11, 13, 0.4) 60%,
      rgba(11, 11, 13, 0.7) 100%
    );
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding: 60px 24px 24px;
    perspective: 1400px;
  }

  /* Pixel-style username (Minecraft vibe) */
  .pixel-name {
    position: absolute;
    top: 32px;
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--font-pixel);
    font-size: 24px;
    letter-spacing: 1px;
    color: rgba(255, 255, 255, 0.95);
    text-shadow:
      2px 2px 0 rgba(0, 0, 0, 0.55),
      0 0 18px rgba(255, 255, 255, 0.1);
    white-space: nowrap;
    z-index: 2;
    pointer-events: none;
  }

  /* Checkerboard 3D floor */
  .floor-grid {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 130%;
    height: 80px;
    transform: translateX(-50%) perspective(220px) rotateX(45deg);
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
    background-size: 28px 28px;
    background-position: center;
    mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent 90%);
    -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent 90%);
    transform-origin: center bottom;
    pointer-events: none;
    opacity: 0.6;
  }

  .hero-bottom {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Instance pill above play button (LabyMod-like default tag) */
  .instance-pill-wrap {
    position: relative;
    align-self: flex-start;
  }
  .instance-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: var(--r-sm);
    background: rgba(255, 255, 255, 0.07);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--border-strong);
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
  }
  .instance-pill:hover { background: rgba(255, 255, 255, 0.12); }

  .inst-dropdown.bottom {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    min-width: 200px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    padding: 4px;
    z-index: 60;
    display: flex; flex-direction: column; gap: 2px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
  }

  /* Quick play row (server icons) */
  .quick-play {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    background: rgba(11, 11, 13, 0.55);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .qp-label {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .qp-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    min-width: 0;
  }
  .qp-list::-webkit-scrollbar { height: 0; }
  .qp-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: var(--r-xs);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .qp-item:hover { background: var(--surface-hover); color: var(--text); }
  .qp-empty {
    color: var(--text-dim);
    font-size: 11px;
    font-style: italic;
    padding: 3px 4px;
  }

  /* Floating launch status (replaces old bottom-tray launch-status) */
  .floating-status {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-radius: var(--r-md);
    background: rgba(11, 11, 13, 0.85);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-strong);
    z-index: 80;
    max-width: 540px;
    animation: fadeIn 0.25s var(--ease) forwards;
  }
  .floating-status .status-text {
    display: flex; flex-direction: column; min-width: 0;
  }
  .floating-status .status-title { font-size: 12px; font-weight: 600; }
  .floating-status .status-sub {
    font-size: 11px; color: var(--text-dim);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 320px; font-family: var(--font-mono);
  }
  .floating-status .console-toggle {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 10px; border-radius: var(--r-sm);
    font-size: 12px; color: var(--text-muted);
    background: var(--surface); border: 1px solid var(--border);
  }
  .floating-status .console-toggle:hover {
    background: var(--surface-hover); color: var(--text);
  }

  /* Skins page */
  .skins-stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: radial-gradient(
      ellipse at 50% 40%,
      rgba(255, 255, 255, 0.05),
      transparent 70%
    );
  }

  /* Language select */
  .lang-select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    font-family: inherit;
    outline: none;
    min-width: 180px;
  }
  .lang-select:focus { border-color: var(--border-strong); }
  .lang-select option { background: var(--bg-elevated); }
</style>

