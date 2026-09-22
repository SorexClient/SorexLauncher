<script lang="ts">
  import { UserPlus, Search } from "lucide-svelte";
  import { createEventDispatcher } from "svelte";
  import { t } from "./i18n";
  import { presenceText, headUrl, type Friend } from "./presence";

  export let friends: Friend[] = [];

  const dispatch = createEventDispatcher();
  let filter = "";

  $: online = friends.filter((f) => f.online);
  $: offline = friends.filter((f) => !f.online);
  $: filteredOnline = online.filter((f) =>
    f.name.toLowerCase().includes(filter.toLowerCase())
  );
  $: filteredOffline = offline.filter((f) =>
    f.name.toLowerCase().includes(filter.toLowerCase())
  );
</script>

<aside class="friends-panel card">
  <header>
    <h3>{$t("friends.title")}</h3>
    <button class="add" title={$t("friends.invite")} on:click={() => dispatch("openFriends")}>
      <UserPlus size={14} />
    </button>
  </header>

  {#if friends.length > 0}
    <div class="search">
      <Search size={12} />
      <input type="text" placeholder="Search..." bind:value={filter} />
    </div>
  {/if}

  <div class="list">
    {#if friends.length === 0}
      <div class="empty">{$t("friends.empty")}</div>
    {:else}
      {#if filteredOnline.length > 0}
        <div class="group-label">{$t("friends.online")} — {filteredOnline.length}</div>
        {#each filteredOnline as f}
          <div class="friend">
            <div class="avatar">
              <img src={headUrl(f.name, 28)} alt={f.name} />
              <span class="dot online"></span>
            </div>
            <div class="info">
              <span class="name">{f.name}</span>
              {#if f.server}
                <span class="status">
                  {$t("friends.playing")} <b>{f.server}</b>
                </span>
              {:else}
                <span class="status muted">{presenceText(f, $t)}</span>
              {/if}
            </div>
          </div>
        {/each}
      {/if}

      {#if filteredOffline.length > 0}
        <div class="group-label offline">{$t("friends.offline")} — {filteredOffline.length}</div>
        {#each filteredOffline as f}
          <div class="friend dim">
            <div class="avatar">
              <img src={headUrl(f.name, 28)} alt={f.name} />
              <span class="dot"></span>
            </div>
            <div class="info">
              <span class="name">{f.name}</span>
              <span class="status muted">{presenceText(f, $t)}</span>
            </div>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</aside>

<style>
  .friends-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    padding: 12px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  h3 {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .add {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-xs);
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .add:hover { color: var(--text); background: var(--surface-hover); }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    margin-bottom: 8px;
    color: var(--text-dim);
  }
  .search input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 12px;
    outline: none;
    font-family: inherit;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 -4px;
    padding: 0 4px;
  }

  .group-label {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-dim);
    padding: 8px 4px 4px;
  }
  .group-label.offline { color: var(--text-dim); }

  .friend {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background 0.18s var(--ease);
  }
  .friend:hover { background: var(--surface-hover); }
  .friend.dim { opacity: 0.55; }
  .friend.dim:hover { opacity: 0.9; }

  .avatar {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: var(--r-xs);
    overflow: visible;
    flex-shrink: 0;
  }
  .avatar img {
    width: 28px;
    height: 28px;
    border-radius: var(--r-xs);
    image-rendering: pixelated;
    display: block;
  }
  .dot {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid var(--bg);
  }
  .dot.online { background: #5ab06a; }

  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status.muted { color: var(--text-dim); }
  .status b { color: var(--text-muted); font-weight: 500; }

  .empty {
    padding: 24px 8px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
