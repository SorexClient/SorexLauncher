<script lang="ts">
  import {
    Gamepad2,
    Box,
    Sparkles,
    Newspaper,
    UserSquare2,
    Users,
    Shield,
    Settings,
  } from "lucide-svelte";
  import { t } from "./i18n";

  export let activeTab = "home";
  export let pendingRequests = 0;

  const items = [
    { id: "home", icon: Gamepad2, key: "nav.play" },
    { id: "instances", icon: Box, key: "nav.instances" },
    { id: "friends", icon: Users, key: "nav.friends" },
    { id: "skins", icon: Sparkles, key: "nav.skins" },
    { id: "news", icon: Newspaper, key: "nav.news" },
    { id: "accounts", icon: UserSquare2, key: "nav.accounts" },
    { id: "security", icon: Shield, key: "nav.security" },
  ];
</script>

<nav class="side-panel">
  <button
    class="brand"
    title="Sorex Launcher"
    onclick={() => (activeTab = "home")}
  >
    <span class="logo-mark">S</span>
    <span class="logo-name">Sorex<span class="logo-sub">Launcher</span></span>
  </button>

  <div class="nav-items">
    {#each items as it}
      <button
        class="nav-item"
        class:active={activeTab === it.id}
        onclick={() => (activeTab = it.id)}
        title={$t(it.key)}
      >
        <svelte:component this={it.icon} size={22} strokeWidth={2.2} />
        {#if it.id === "friends" && pendingRequests > 0}
          <span class="nav-badge">{pendingRequests > 9 ? "9+" : pendingRequests}</span>
        {/if}
        <span class="lbl">{$t(it.key)}</span>
      </button>
    {/each}
  </div>

  <button
    class="nav-item settings"
    class:active={activeTab === "settings"}
    onclick={() => (activeTab = "settings")}
    title={$t("nav.settings")}
  >
    <Settings size={22} strokeWidth={2.2} />
    <span class="lbl">{$t("nav.settings")}</span>
  </button>
</nav>

<style>
  .side-panel {
    width: 84px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 10px 8px;
    gap: 4px;
    background: rgba(11, 11, 13, 0.6);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border-right: 1px solid var(--border);
    z-index: 100;
  }

  .brand {
    display: none; /* shown only in the top-bar in this layout; keep markup for fallback */
  }
  .logo-mark, .logo-name, .logo-sub { display: none; }

  .nav-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    overflow-y: auto;
  }

  .nav-item {
    width: 100%;
    padding: 10px 4px 7px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    color: var(--text-dim);
    border-radius: var(--r-sm);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.18s var(--ease);
    position: relative;
  }

  .nav-item .lbl {
    font-size: 10.5px;
    font-weight: 500;
    line-height: 1.2;
    max-width: 100%;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    text-align: center;
  }

  .nav-badge {
    position: absolute;
    top: 4px;
    right: 8px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-contrast, #0b0b0d);
    font-size: 9.5px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .nav-item:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .nav-item.active {
    background: var(--surface-active);
    color: var(--accent);
  }

  .nav-item.active::before {
    content: "";
    position: absolute;
    left: -8px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 22px;
    background: var(--accent);
    border-radius: 2px;
  }

  .download-update {
    margin-top: auto;
    color: var(--text-dim);
  }
  .download-update:hover { color: var(--text); }

  .settings {
    margin-top: 4px;
    color: var(--text-dim);
  }
  .settings.active::before { background: var(--accent); }
  .settings.active { color: var(--accent); }

  :global(svg) { transition: transform 0.2s ease; }
</style>
