<script lang="ts">
  import { Play, Loader2, Square, ArrowLeftRight } from "lucide-svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "./i18n";

  export let launching = false;
  export let gameRunning = false;
  export let progress = 0;
  export let version = "1.21.4";
  export let loader = "Fabric";
  export let instanceName = "Default";

  const dispatch = createEventDispatcher();
</script>

<div class="hero-play-wrap">
  <button
    class="hero-play"
    class:launching
    class:running={gameRunning}
    on:click={() => !launching && dispatch("launch")}
  >
    <div class="icon-circle">
      {#if launching}
        <Loader2 class="spinner" size={20} strokeWidth={2.5} />
      {:else if gameRunning}
        <Square size={18} fill="white" strokeWidth={0} />
      {:else}
        <Play size={20} fill="white" strokeWidth={0} />
      {/if}
    </div>
    <div class="text">
      <span class="title">
        {#if launching}
          {$t("play.launching")} {progress}%
        {:else if gameRunning}
          {$t("play.stop")}
        {:else}
          {$t("play.start")} {version}
        {/if}
      </span>
      <span class="sub">{loader} · {instanceName}</span>
    </div>
    {#if launching && progress > 0}
      <div class="bar" style="width: {progress}%"></div>
    {/if}
  </button>

  <button class="switch-btn" title={$t("home.manage")} on:click={() => dispatch("switch")}>
    <ArrowLeftRight size={16} strokeWidth={2.3} />
  </button>
</div>

<style>
  .hero-play-wrap {
    display: flex;
    align-items: stretch;
    gap: 8px;
  }

  .hero-play {
    position: relative;
    overflow: hidden;
    flex: 1;
    height: 56px;
    padding: 0 18px 0 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-radius: var(--r-md);
    background: var(--accent);
    color: var(--accent-contrast, #0b0b0d);
    transition: transform 0.18s var(--ease), box-shadow 0.18s var(--ease), opacity 0.18s var(--ease);
    box-shadow: var(--accent-glow, 0 6px 22px rgba(0, 0, 0, 0.3));
  }

  .hero-play:hover:not(.launching):not(.running) {
    transform: translateY(-1px);
    background: var(--primary-hover);
  }

  .hero-play.launching {
    background: linear-gradient(135deg, #2a2a30 0%, #1c1c20 100%);
    color: var(--text-muted);
    cursor: wait;
    box-shadow: none;
  }

  .hero-play.running {
    background: linear-gradient(135deg, #d33b3b 0%, #b62e2e 100%);
    box-shadow: 0 6px 22px rgba(211, 59, 59, 0.3);
  }

  .icon-circle {
    width: 40px;
    height: 40px;
    border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.2;
    min-width: 0;
  }
  .title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -0.2px;
    color: inherit;
  }
  .sub {
    font-size: 11px;
    color: rgba(0, 0, 0, 0.65);
    font-weight: 500;
  }

  .bar {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: rgba(0, 0, 0, 0.4);
    transition: width 0.3s var(--ease);
  }

  .switch-btn {
    width: 44px;
    height: 56px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .switch-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
    border-color: var(--border-strong);
  }

  :global(.spinner) { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
