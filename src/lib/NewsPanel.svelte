<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { t } from "./i18n";

  export let items: {
    title: string;
    subtitle?: string;
    tag?: string;
    accent?: string;   // background gradient style for the banner
    image?: string;
    url?: string;
  }[] = [];

  const dispatch = createEventDispatcher();

  function openItem(it: { url?: string }) {
    if (it.url) {
      try { window.open(it.url, "_blank"); } catch {}
    }
  }
</script>

<aside class="news-panel">
  <header>
    <h3>{$t("news.title")}</h3>
    <button class="link" on:click={() => dispatch("viewAll")}>{$t("news.viewAll")}</button>
  </header>

  <div class="list">
    {#each items as it}
      <div
        class="banner"
        style={it.accent ? `background: ${it.accent}` : ""}
        role={it.url ? "button" : undefined}
        tabindex={it.url ? 0 : undefined}
        on:click={() => openItem(it)}
        on:keydown={(e) => { if ((e.key === "Enter" || e.key === " ") && it.url) openItem(it); }}
      >
        {#if it.image}
          <img src={it.image} alt="" />
          <div class="scrim"></div>
        {/if}
        <div class="content">
          {#if it.tag}<span class="tag">{it.tag}</span>{/if}
          <h4>{it.title}</h4>
          {#if it.subtitle}<p>{it.subtitle}</p>{/if}
        </div>
      </div>
    {/each}
  </div>
</aside>

<style>
  .news-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding: 0 2px;
  }
  h3 {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .link {
    font-size: 11px;
    color: var(--text-dim);
    padding: 2px 6px;
    border-radius: var(--r-xs);
  }
  .link:hover { background: var(--surface-hover); color: var(--text); }

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0 -4px;
    padding: 0 4px 4px;
  }

  .banner {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--r-md);
    overflow: hidden;
    cursor: pointer;
    background: var(--surface);
    border: 1px solid var(--border);
    transition: transform 0.2s var(--ease);
    flex-shrink: 0;
  }
  .banner:hover { transform: translateY(-1px); }

  .banner img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.6) 100%);
  }

  .content {
    position: absolute;
    inset: auto 0 0 0;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .tag {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    padding: 2px 6px;
    border-radius: var(--r-xs);
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    width: fit-content;
    color: #fff;
    margin-bottom: 2px;
  }
  .banner h4 {
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    line-height: 1.2;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  .banner p {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.78);
    line-height: 1.3;
  }
</style>
