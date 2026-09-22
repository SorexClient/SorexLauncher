<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { X } from "lucide-svelte";

  export let open = false;
  export let title = "New Instance";
  export let versions: string[] = ["1.21.4", "1.20.1"];

  let name = "";
  let version = versions[0];
  let creating = false;

  const dispatch = createEventDispatcher();

  $: if (open) {
    name = "";
    version = versions[0] || "1.21.4";
    creating = false;
  }

  async function submit() {
    if (!name.trim()) return;
    creating = true;
    dispatch("create", { name: name.trim(), version });
  }

  function close() { dispatch("close"); }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="overlay" on:click={close}>
    <div class="modal" on:click|stopPropagation>
      <div class="header">
        <h3>{title}</h3>
        <button class="close" on:click={close}><X size={16} /></button>
      </div>

      <div class="body">
        <label>
          <span>Name</span>
          <input
            type="text"
            placeholder="e.g. PvP Loadout"
            bind:value={name}
            autofocus
            on:keydown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        <label>
          <span>Minecraft version</span>
          <select bind:value={version}>
            {#each versions as v}<option value={v}>{v}</option>{/each}
          </select>
          <small>Fabric loader is selected automatically.</small>
        </label>
      </div>

      <div class="footer">
        <button class="btn ghost" on:click={close}>Cancel</button>
        <button class="btn primary" on:click={submit} disabled={!name.trim() || creating}>
          {creating ? "Creating..." : "Create instance"}
        </button>
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
    width: 380px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    overflow: hidden;
    animation: fadeIn 0.25s var(--ease) forwards;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .header h3 { font-size: 14px; font-weight: 600; }
  .close {
    width: 24px; height: 24px; display: flex; align-items: center;
    justify-content: center; border-radius: var(--r-xs); color: var(--text-dim);
  }
  .close:hover { background: var(--surface-hover); color: var(--text); }

  .body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  label { display: flex; flex-direction: column; gap: 6px; }
  label span { font-size: 12px; color: var(--text-muted); font-weight: 500; }
  input, select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 10px;
    border-radius: var(--r-sm);
    font-size: 13px;
    outline: none;
    font-family: inherit;
  }
  input:focus, select:focus { border-color: var(--border-strong); }
  small { font-size: 11px; color: var(--text-dim); }

  .footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; border-top: 1px solid var(--border);
  }
  .btn {
    padding: 7px 14px;
    border-radius: var(--r-sm);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn.ghost { background: transparent; color: var(--text-muted); }
  .btn.ghost:hover { background: var(--surface-hover); color: var(--text); }
  .btn.primary { background: var(--accent); color: var(--accent-contrast, #0b0b0d); font-weight: 600; }
  .btn.primary:hover:not(:disabled) { background: var(--primary-hover); }
  .btn.primary:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
