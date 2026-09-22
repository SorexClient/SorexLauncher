<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  export let username: string = "Steve";
  export let width: number = 220;
  export let height: number = 300;

  let canvas: HTMLCanvasElement;
  let viewer: any = null;
  let walkAnimation: any = null;
  let mounted = false;
  let loadError = false;

  // Dynamic import so SSR / iframe-preview can't break on missing WebGL.
  async function initViewer() {
    try {
      const mod = await import("skinview3d");
      if (!mounted || !canvas) return;

      viewer = new mod.SkinViewer({
        canvas,
        width,
        height,
        skin: `https://minotar.net/skin/${encodeURIComponent(username)}`,
      });

      viewer.fov = 32;
      viewer.zoom = 0.85;
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.background = null; // transparent

      walkAnimation = new mod.WalkingAnimation();
      walkAnimation.speed = 0.55;
      viewer.animation = walkAnimation;
    } catch (err) {
      console.error("[SkinViewer] init failed:", err);
      loadError = true;
    }
  }

  $: if (viewer && username) {
    try {
      viewer.loadSkin(`https://minotar.net/skin/${encodeURIComponent(username)}`);
    } catch {}
  }

  onMount(() => {
    mounted = true;
    initViewer();
  });

  onDestroy(() => {
    mounted = false;
    try {
      viewer?.dispose?.();
    } catch {}
    viewer = null;
  });
</script>

<div class="skin-stage" style="width: {width}px; height: {height}px">
  <div class="floor-shadow"></div>
  <div class="floor-ring"></div>
  <canvas bind:this={canvas} class:hidden={loadError}></canvas>
  {#if loadError}
    <div class="fallback">
      <img
        src="https://minotar.net/armor/body/{username}/{Math.floor(height * 0.75)}"
        alt={username}
      />
    </div>
  {/if}
</div>

<style>
  .skin-stage {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    perspective: 800px;
  }

  canvas {
    display: block;
    background: transparent;
    /* Subtle 3D presence on the page */
    filter: drop-shadow(0 18px 24px rgba(0, 0, 0, 0.55));
    transform: translateZ(0);
  }

  canvas.hidden { display: none; }

  /* Soft ground shadow under the model */
  .floor-shadow {
    position: absolute;
    bottom: 22px;
    left: 50%;
    width: 60%;
    height: 18px;
    transform: translateX(-50%);
    background: radial-gradient(
      ellipse at center,
      rgba(0, 0, 0, 0.55) 0%,
      rgba(0, 0, 0, 0) 70%
    );
    filter: blur(4px);
    pointer-events: none;
  }

  /* Subtle ring that hints at a stage / 3D floor plane */
  .floor-ring {
    position: absolute;
    bottom: 14px;
    left: 50%;
    width: 70%;
    height: 24px;
    transform: translateX(-50%) rotateX(72deg);
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: radial-gradient(
      ellipse at center,
      rgba(255, 255, 255, 0.04) 0%,
      transparent 70%
    );
    pointer-events: none;
  }

  .fallback {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fallback img {
    image-rendering: pixelated;
    filter: drop-shadow(0 12px 20px rgba(0, 0, 0, 0.5));
  }
</style>
