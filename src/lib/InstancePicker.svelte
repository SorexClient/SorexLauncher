<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { X, Package } from "lucide-svelte";

  export let open = false;
  export let mod: { title?: string; icon_url?: string } | null = null;
  export let instances: any[] = [];
  export let activeInstanceId: string | null = null;

  const dispatch = createEventDispatcher();

  function pick(inst: any) {
    dispatch("pick", inst);
  }
  function close() { dispatch("close"); }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="overlay" on:click={close}>
    <div class="modal" on:click|stopPropagation>
      <div class="header">
        <div class="head-left">
          {#if mod?.icon_url}
            <img src={mod.icon_url} alt={mod.title} />
          {:else}
            <div class="icon-fallback"><Package size={16} /></div>
          {/if}
          <div>
            <h3>Install {mod?.title || "mod"}</h3>
            <p>Choose the instance that should receive this mod.</p>
          </div>
        </div>
        <button class="close" on:click={close}><X size={16} /></button>
      </div>

      <div class="list">
        {#each instances as inst}
          <button class="row" class:active={inst.id === activeInstanceId} on:click={() => pick(inst)}>
            <div class="row-icon">{inst.name?.[0]?.toUpperCase() || "?"}</div>
            <div class="row-info">
              <span class="name">{inst.name}</span>
              <span class="meta">{inst.version} · {inst.loader}</span>
            </div>
            {#if inst.id === activeInstanceId}<span class="pill">Active</span>{/if}
          </button>
        {/each}
        {#if instances.length === 0}
          <div class="empty">No instances yet — create one first.</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s var(--ease) forwards;
  }
  .modal {
    width: 420px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    gap: 12px;
  }
  .head-left { display: flex; gap: 12px; align-items: center; }
  .head-left img { width: 36px; height: 36px; border-radius: var(--r-sm); image-rendering: auto; }
  .icon-fallback {
    width: 36px; height: 36px; border-radius: var(--r-sm);
    background: var(--surface-active); border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center; color: var(--text-muted);
  }
  .header h3 { font-size: 14px; font-weight: 600; }
  .header p { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }
  .close {
    width: 24px; height: 24px; display: flex; align-items: center;
    justify-content: center; border-radius: var(--r-xs); color: var(--text-dim);
  }
  .close:hover { background: var(--surface-hover); color: var(--text); }

  .list { padding: 8px; max-height: 320px; overflow-y: auto; }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    text-align: left;
  }
  .row:hover { background: var(--surface-hover); }
  .row.active { background: var(--surface-active); }
  .row-icon {
    width: 30px; height: 30px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    font-weight: 600; font-size: 12px; color: var(--text-muted);
  }
  .row-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .name { font-size: 13px; font-weight: 500; }
  .meta { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); }
  .pill {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: var(--r-xs);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .empty { padding: 24px; text-align: center; font-size: 12px; color: var(--text-dim); }
</style>
