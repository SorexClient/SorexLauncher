<script lang="ts">
  import { Terminal, X, Copy, Trash2, FolderOpen, ArrowDownToLine, Check } from "lucide-svelte";
  import { createEventDispatcher, afterUpdate } from "svelte";

  export let open = false;
  export let logs: { time: string; text: string; level: string }[] = [];
  export let gameRunning = false;
  export let launching = false;

  const dispatch = createEventDispatcher();

  let viewport: HTMLDivElement;
  let autoScroll = true;
  let filter = "";
  let activeLevel: string = "all";
  let copied = false;

  const levels = [
    { id: "all", label: "All" },
    { id: "error", label: "Errors" },
    { id: "warn", label: "Warnings" },
    { id: "info", label: "Info" },
    { id: "debug", label: "Debug" },
  ];

  function matchesLevel(level: string) {
    if (activeLevel === "all") return true;
    if (activeLevel === "info") return ["info", "success", "download"].includes(level);
    if (activeLevel === "debug") return ["debug", "data"].includes(level);
    return level === activeLevel;
  }

  $: filtered = logs.filter(
    (l) =>
      matchesLevel(l.level) &&
      (!filter || l.text.toLowerCase().includes(filter.toLowerCase()))
  );

  // Auto-scroll AFTER the DOM has updated. Using afterUpdate (instead of a
  // reactive `$:` block) avoids a feedback loop: setting scrollTop fires a
  // scroll event, and Svelte invalidates on every assignment, which with a
  // reactive block would re-trigger itself endlessly and freeze the renderer.
  let suppressScrollHandler = false;
  afterUpdate(() => {
    if (open && autoScroll && viewport) {
      suppressScrollHandler = true;
      viewport.scrollTop = viewport.scrollHeight;
      // Release on the next frame, after the programmatic scroll event fires.
      requestAnimationFrame(() => (suppressScrollHandler = false));
    }
  });

  function onScroll() {
    if (!viewport || suppressScrollHandler) return;
    const nearBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
    if (nearBottom !== autoScroll) autoScroll = nearBottom; // guard: only assign on real change
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(
        logs.map((l) => `[${l.time}] ${l.text}`).join("\n")
      );
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (e) {}
  }

  function jumpToBottom() {
    autoScroll = true;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }

  $: statusLabel = launching ? "Launching" : gameRunning ? "Running" : "Idle";
  $: statusClass = launching ? "launching" : gameRunning ? "running" : "idle";
</script>

{#if open}
  <div class="console-overlay" on:click={() => dispatch("close")}>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="console-panel glass" on:click|stopPropagation>
      <div class="console-header">
        <div class="title">
          <div class="term-icon"><Terminal size={16} /></div>
          <span>Live Console</span>
          <span class="status-pill {statusClass}">
            <span class="dot"></span>{statusLabel}
          </span>
          <span class="count">{logs.length} lines</span>
        </div>
        <div class="header-actions">
          <button class="icon-btn" title="Copy all" on:click={copyAll}>
            {#if copied}<Check size={15} />{:else}<Copy size={15} />{/if}
          </button>
          <button
            class="icon-btn"
            title="Open log folder"
            on:click={() => dispatch("openFolder")}
          >
            <FolderOpen size={15} />
          </button>
          <button class="icon-btn" title="Clear" on:click={() => dispatch("clear")}>
            <Trash2 size={15} />
          </button>
          <button class="icon-btn close" title="Close" on:click={() => dispatch("close")}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div class="console-toolbar">
        <input
          class="filter-input"
          type="text"
          placeholder="Filter logs..."
          bind:value={filter}
        />
        <div class="level-tabs">
          {#each levels as lvl}
            <button
              class="level-tab"
              class:active={activeLevel === lvl.id}
              on:click={() => (activeLevel = lvl.id)}
            >
              {lvl.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="console-body" bind:this={viewport} on:scroll={onScroll}>
        {#if filtered.length === 0}
          <div class="empty-state">
            <Terminal size={28} />
            <p>{logs.length === 0 ? "No output yet. Launch the game to see live logs." : "No lines match your filter."}</p>
          </div>
        {:else}
          {#each filtered as line}
            <div class="log-line {line.level}">
              <span class="ts">{line.time}</span>
              <span class="txt">{line.text}</span>
            </div>
          {/each}
        {/if}
      </div>

      {#if !autoScroll}
        <button class="jump-btn" on:click={jumpToBottom} title="Jump to latest">
          <ArrowDownToLine size={16} /> Latest
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .console-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 900;
    animation: fadeIn 0.25s var(--ease) forwards;
  }

  .console-panel {
    width: calc(100% - 32px);
    height: 70%;
    margin: 0 16px 16px 16px;
    border-radius: var(--r-md);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: rgba(13, 13, 16, 0.85);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-strong);
    box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.4);
    position: relative;
    animation: slideUp 0.28s var(--ease) forwards;
  }

  @keyframes slideUp {
    from { transform: translateY(40px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .console-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }

  .term-icon {
    width: 22px;
    height: 22px;
    border-radius: var(--r-xs);
    background: var(--surface-active);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 7px;
    border-radius: var(--r-xs);
    border: 1px solid var(--border);
  }

  .status-pill .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  .status-pill.idle { background: var(--surface); color: var(--text-dim); }
  .status-pill.idle .dot { background: var(--text-dim); }
  .status-pill.launching { background: var(--surface); color: #d4a557; }
  .status-pill.launching .dot { background: #d4a557; animation: blink 1.4s infinite; }
  .status-pill.running { background: var(--surface); color: #5ab06a; }
  .status-pill.running .dot { background: #5ab06a; }

  @keyframes blink { 50% { opacity: 0.4; } }

  .count {
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 400;
    font-family: var(--font-mono);
  }

  .header-actions {
    display: flex;
    gap: 6px;
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-xs);
    color: var(--text-dim);
    background: transparent;
    transition: all 0.18s var(--ease);
  }

  .icon-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .icon-btn.close:hover {
    background: rgba(211, 59, 59, 0.85);
    color: #fff;
  }

  .console-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }

  .filter-input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 6px 10px;
    color: var(--text);
    font-size: 12px;
    outline: none;
    transition: border-color 0.18s;
    font-family: var(--font-mono);
  }

  .filter-input:focus {
    border-color: var(--border-strong);
    background: var(--surface-hover);
  }

  .level-tabs {
    display: flex;
    gap: 2px;
    background: var(--surface);
    padding: 2px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
  }

  .level-tab {
    padding: 4px 9px;
    border-radius: var(--r-xs);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dim);
    transition: all 0.18s var(--ease);
  }

  .level-tab:hover { color: var(--text); }

  .level-tab.active {
    background: var(--surface-active);
    color: var(--text);
  }

  .console-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 18px;
    font-family: "JetBrains Mono", "Consolas", "Monaco", monospace;
    font-size: 12.5px;
    line-height: 1.65;
  }

  .log-line {
    display: flex;
    gap: 12px;
    padding: 1px 0;
    white-space: pre-wrap;
    word-break: break-word;
    animation: fadeIn 0.2s var(--ease);
  }

  .log-line .ts {
    color: rgba(255, 255, 255, 0.25);
    flex-shrink: 0;
    user-select: none;
  }

  .log-line .txt { color: rgba(255, 255, 255, 0.78); }

  .log-line.debug .txt { color: rgba(245, 245, 247, 0.4); }
  .log-line.data .txt { color: rgba(245, 245, 247, 0.55); }
  .log-line.download .txt { color: rgba(245, 245, 247, 0.75); }
  .log-line.success .txt { color: #7cb583; }
  .log-line.warn .txt { color: #d4a557; }
  .log-line.error .txt { color: #e07070; font-weight: 500; }

  .empty-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dim);
    text-align: center;
  }

  .jump-btn {
    position: absolute;
    bottom: 16px;
    right: 18px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: var(--r-sm);
    font-size: 11px;
    font-weight: 500;
    color: var(--text);
    background: var(--surface-active);
    border: 1px solid var(--border-strong);
    animation: fadeIn 0.18s var(--ease);
  }

  .jump-btn:hover { background: var(--surface-hover); }
</style>
