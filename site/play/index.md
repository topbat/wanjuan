---
layout: page
sidebar: false
title: 互动玩法
description: 飞花令与成语接龙两局纯前端人机对战：用 2,257 句诗文与 370 条成语轮流对句，支持换令字、提示、连击与本地最长链记录。
---

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import FlyingFlowerGame from '../.vitepress/theme/components/FlyingFlowerGame.vue'
import IdiomChainGame from '../.vitepress/theme/components/IdiomChainGame.vue'

type GameKey = 'flower' | 'chain'

const active = ref<GameKey>('flower')

function syncFromUrl() {
  if (typeof window === 'undefined') return
  const game = new URLSearchParams(window.location.search).get('game')
  active.value = game === 'chain' ? 'chain' : 'flower'
}

function setGame(game: GameKey) {
  active.value = game
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('game', game)
  window.history.replaceState(window.history.state, '', url.toString())
}

function onTabKey(event: KeyboardEvent) {
  const key = event.key
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
  event.preventDefault()
  const next: GameKey = key === 'ArrowLeft' || key === 'Home' ? 'flower' : 'chain'
  setGame(next)
  const el = document.getElementById(next === 'flower' ? 'wj-tab-flower' : 'wj-tab-chain')
  el?.focus()
}

onMounted(() => {
  syncFromUrl()
  window.addEventListener('popstate', syncFromUrl)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncFromUrl)
})
</script>

<div class="wj-play">
  <header class="wj-play-hero">
    <p class="wj-play-kicker">万卷 · 互动玩法</p>
    <h1 class="wj-play-title">把诗库与成语库，玩成一场对句</h1>
    <p class="wj-play-lead">
      两局纯前端人机对战，全部取材于站内构建索引：飞花令用 <b>2,257 句</b>诗文，
      成语接龙用 <b>370 条</b>成语。不联网、不记名，打开即玩。
    </p>
  </header>

  <div class="wj-play-tabs" role="tablist" aria-label="选择玩法">
    <button
      id="wj-tab-flower"
      type="button"
      role="tab"
      class="wj-play-tab"
      :class="{ on: active === 'flower' }"
      :aria-selected="active === 'flower'"
      :tabindex="active === 'flower' ? 0 : -1"
      aria-controls="wj-play-panel"
      @click="setGame('flower')"
      @keydown="onTabKey"
    >
      <span class="wj-play-tab-main">
        <span class="wj-play-tab-name">飞花令</span>
        <span class="wj-play-tab-desc">选一枚令字，与 AI 轮流说出含令字的诗句</span>
      </span>
      <span class="wj-play-tab-n">2,257 句</span>
    </button>
    <button
      id="wj-tab-chain"
      type="button"
      role="tab"
      class="wj-play-tab"
      :class="{ on: active === 'chain' }"
      :aria-selected="active === 'chain'"
      :tabindex="active === 'chain' ? 0 : -1"
      aria-controls="wj-play-panel"
      @click="setGame('chain')"
      @keydown="onTabKey"
    >
      <span class="wj-play-tab-main">
        <span class="wj-play-tab-name">成语接龙</span>
        <span class="wj-play-tab-desc">用首字拼音接上末字，AI 优先同语义场</span>
      </span>
      <span class="wj-play-tab-n">370 条</span>
    </button>
  </div>

  <div
    id="wj-play-panel"
    class="wj-play-panel"
    role="tabpanel"
    :aria-labelledby="active === 'flower' ? 'wj-tab-flower' : 'wj-tab-chain'"
  >
    <KeepAlive>
      <component :is="active === 'flower' ? FlyingFlowerGame : IdiomChainGame" />
    </KeepAlive>
  </div>

  <p class="wj-play-foot">
    数据来自 <code>/indexes/lines.json</code>（2,257 句）与
    <code>/indexes/idioms.json</code>（370 条）；判定与计分全部在浏览器本地完成。
  </p>
</div>

<style scoped>
.wj-play {
  box-sizing: border-box;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 10px clamp(14px, 2.6vw, 30px) 50px;
}

.wj-play-hero {
  padding: 8px 0 4px;
}

.wj-play-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.24em;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  text-transform: uppercase;
}

.wj-play-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: clamp(26px, 4vw, 40px);
  line-height: 1.3;
  letter-spacing: 0.02em;
  color: var(--wj-ink);
  font-weight: var(--wj-display-weight);
}

.wj-play-lead {
  margin: 10px 0 0;
  max-width: 72ch;
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--wj-ink-2);
}

.wj-play-lead b {
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 1.05em;
}

.wj-play-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 22px 0 18px;
}

.wj-play-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  color: var(--wj-ink);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--wj-shadow);
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.wj-play-tab:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--wj-accent) 45%, var(--wj-line));
}

.wj-play-tab.on {
  border-color: var(--wj-accent);
  background: color-mix(in srgb, var(--wj-accent-tint) 65%, var(--wj-card));
  box-shadow: inset 0 0 0 1px var(--wj-accent);
}

.wj-play-tab:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--wj-accent) 35%, transparent);
  outline-offset: 3px;
}

.wj-play-tab-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.wj-play-tab-name {
  font-family: var(--wj-font-display);
  font-size: 19px;
  letter-spacing: 0.04em;
  color: var(--wj-ink);
  font-weight: var(--wj-display-weight);
}

.wj-play-tab.on .wj-play-tab-name {
  color: var(--wj-accent);
}

.wj-play-tab-desc {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--wj-ink-2);
}

.wj-play-tab-n {
  flex: none;
  padding: 3px 10px;
  border: 1px solid var(--wj-line);
  border-radius: 999px;
  color: var(--wj-ink-3);
  font-size: 11px;
  white-space: nowrap;
}

.wj-play-tab.on .wj-play-tab-n {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-card);
}

.wj-play-panel {
  min-height: 320px;
  outline: none;
}

.wj-play-panel:focus-visible {
  outline: 2px dashed var(--wj-line);
  outline-offset: 4px;
}

.wj-play-foot {
  margin: 26px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--wj-line);
  font-size: 12px;
  line-height: 1.7;
  color: var(--wj-ink-3);
}

.wj-play-foot code {
  font-size: 11.5px;
}

[data-theme='ink'] .wj-play-title {
  letter-spacing: 0.1em;
}

[data-theme='ink'] .wj-play-tab.on {
  box-shadow: inset 0 0 0 2px var(--wj-accent);
}

[data-theme='editorial'] .wj-play-tab {
  border-radius: 0;
  box-shadow: inset 0 0 0 1px var(--wj-line);
}

[data-theme='editorial'] .wj-play-tab.on {
  box-shadow: inset 0 0 0 2px var(--wj-ink);
}

[data-theme='youth'] .wj-play-tab {
  border-width: 2px;
}

@media (max-width: 720px) {
  .wj-play-tabs {
    grid-template-columns: 1fr;
  }
  .wj-play {
    padding-bottom: 38px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wj-play-tab {
    transition: none;
  }
  .wj-play-tab:hover {
    transform: none;
  }
}
</style>