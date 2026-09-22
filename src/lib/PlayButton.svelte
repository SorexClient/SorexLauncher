<script lang="ts">
  import { Play, Loader2, Square } from 'lucide-svelte';
  
  export let launching = false;
  export let gameRunning = false;
  export let progress = 0;
  export let versions: string[] = ["1.20.1"];
  export let selectedVersion = "1.20.1";
  
  let showDropdown = false;
  
  function handleClick() {
    if (!launching) {
      dispatch('launch');
    }
  }

  function selectVersion(v: string) {
    selectedVersion = v;
    showDropdown = false;
    dispatch('versionChange', v);
  }

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  import { ChevronDown } from 'lucide-svelte';
</script>

<div class="play-container">
  <button 
    class="play-btn" 
    class:launching 
    class:running={gameRunning} 
    on:click={handleClick}
  >
    {#if launching}
      <Loader2 class="spinner" size={24} />
      <span>Launching... {progress}%</span>
    {:else if gameRunning}
      <Square size={22} fill="white" />
      <span>STOP GAME</span>
    {:else}
      <Play size={24} fill="white" />
      <span>PLAY NOW</span>
    {/if}
  </button>
  
  <div class="version-select-container">
    <button class="version-select glass" on:click={() => showDropdown = !showDropdown}>
      <span class="version">{selectedVersion}</span>
      <span class="type">Fabric</span>
      <ChevronDown size={14} class="chevron {showDropdown ? 'rotate' : ''}" />
    </button>

    {#if showDropdown}
      <div class="dropdown glass animate-fade-in">
        {#each versions as v}
          <button class="dropdown-item" class:active={v === selectedVersion} on:click={() => selectVersion(v)}>
            {v}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .play-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .play-btn {
    position: relative;
    overflow: hidden;
    width: 260px;
    height: 44px;
    background: var(--accent);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--accent-contrast, #0b0b0d);
    font-family: var(--font-display, 'Inter', sans-serif);
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.2px;
    transition: opacity 0.18s var(--ease), background 0.18s var(--ease);
  }

  .play-btn:hover {
    background: var(--primary-hover);
  }

  .dropdown-item.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .version-select:focus,
  .version-select:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .play-btn.launching::before,
  .play-btn.running::before {
    display: none;
  }

  .play-btn.launching {
    background: var(--surface-active);
    color: var(--text-muted);
    cursor: wait;
  }

  .play-btn.running {
    background: #d33b3b;
    color: #fff;
  }

  .play-btn.running:hover {
    background: #c93030;
    opacity: 1;
  }

  :global(.spinner) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .version-select-container {
    position: relative;
    display: flex;
    justify-content: center;
  }

  .version-select {
    padding: 5px 10px;
    border-radius: var(--r-sm);
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-muted);
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .version-select:hover {
    background: var(--surface-hover);
  }

  :global(.chevron) {
    transition: transform 0.2s ease;
  }

  :global(.chevron.rotate) {
    transform: rotate(180deg);
  }

  .dropdown {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: 180px;
    max-height: 200px;
    overflow-y: auto;
    border-radius: var(--r-md);
    padding: 4px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
  }

  .dropdown-item {
    padding: 7px 10px;
    border-radius: var(--r-xs);
    text-align: left;
    width: 100%;
    color: var(--text-muted);
    font-size: 12.5px;
  }

  .dropdown-item:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .dropdown-item.active {
    background: var(--surface-active);
    color: var(--text);
  }

  .version {
    font-weight: 500;
    font-family: var(--font-mono);
  }

  .type {
    color: var(--text-dim);
    font-size: 10.5px;
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 1px 5px;
    border-radius: var(--r-xs);
  }
</style>
