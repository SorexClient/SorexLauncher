<script lang="ts">
  import { X, Minus, Square, Copy } from "lucide-svelte";
  import { onMount } from "svelte";

  export let isLivePreview: boolean = false;
  let isMaximized = false;

  onMount(() => {
    // @ts-ignore
    window.electronAPI.onMaximized((maximized: boolean) => {
      isMaximized = maximized;
    });
  });

  function minimize() {
    // @ts-ignore
    window.electronAPI.minimize();
  }

  function toggleMaximize() {
    // @ts-ignore
    window.electronAPI.maximize();
  }

  function close() {
    // @ts-ignore
    window.electronAPI.close();
  }
</script>

<div class="top-bar glass" data-tauri-drag-region>
  <div class="brand">
    <img src="./logo.png" alt="Sorex Launcher Logo" class="logo-img" />
    <span class="name">Sorex<span class="accent">Launcher</span></span>
  </div>

  {#if !isLivePreview}
  <div class="controls text-white/40">
    <button class="control-btn" on:click={minimize}><Minus size={18} /></button>
    <button class="control-btn" on:click={toggleMaximize}>
      {#if isMaximized}
        <Copy size={16} />
      {:else}
        <Square size={16} />
      {/if}
    </button>
    <button class="control-btn close" on:click={close}><X size={18} /></button>
  </div>
  {/if}
</div>

<style>
  .top-bar {
    height: 48px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: var(--glass-border);
    z-index: 100;
    -webkit-app-region: drag;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo-img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  .name {
    font-weight: 600;
    letter-spacing: -0.5px;
    font-size: 18px;
  }

  .accent {
    color: var(--secondary);
    font-weight: 800;
  }

  .controls {
    display: flex;
    gap: 2px;
    -webkit-app-region: no-drag;
  }

  .control-btn {
    width: 38px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    border-radius: 4px;
    transition: all 0.2s ease;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .control-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
  }

  .control-btn.close:hover {
    background: #e81123;
    color: white;
    border-radius: 4px;
  }
</style>
