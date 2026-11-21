<script setup lang="ts">
// 万卷 · 名句卡片
// 三种形态：gallery（画廊，诗体大字）/ list（列表，单行速览）/ wall（主题墙，紧凑）
// 卡片主体由覆盖整卡的 <a> 承担导航，复制/展开/词条链接置于其上（z-index），保证整卡可点又不误触。
import { computed } from 'vue'

type CardQuote = {
  id: string
  text: string
  author: string
  workTitle: string
  workRoute: string
  entryRoute: string
  theme: string[]
  dynasty: string
  stageLabel: string
  scene: string
  sourceLabel: string
}

const props = withDefaults(
  defineProps<{
    quote: CardQuote
    variant?: 'gallery' | 'list' | 'wall'
    expanded?: boolean
    copied?: boolean
    context?: string
    contextLoading?: boolean
    contextError?: string
    allowExpand?: boolean
    /** 同一名句可能在主题墙中出现多次，用分组 key 保证 aria-controls 唯一 */
    uid?: string
  }>(),
  {
    variant: 'gallery',
    expanded: false,
    copied: false,
    context: '',
    contextLoading: false,
    contextError: '',
    allowExpand: true,
    uid: '',
  },
)

const emit = defineEmits<{
  (e: 'toggle-context', quote: CardQuote): void
  (e: 'copy', quote: CardQuote): void
}>()

const themes = computed(() => (props.quote.theme ?? []).slice(0, 2))
const ctxId = computed(() => `wj-qcard-ctx-${props.uid || 'single'}-${props.quote.id}`)
const isList = computed(() => props.variant === 'list')

const overlayLabel = computed(
  () => `打开名句词条：${props.quote.text}（${props.quote.sourceLabel}）`,
)
</script>

<template>
  <article
    class="wj-qcard"
    :class="[
      `wj-qcard--${variant}`,
      { open: expanded, copied, 'wj-panel': variant !== 'list' },
    ]"
    :role="isList ? 'listitem' : undefined"
  >
    <a class="wj-qcard-hit" :href="quote.entryRoute" :aria-label="overlayLabel" />

    <div v-if="isList" class="wj-qcard-row">
      <p class="wj-qcard-text">{{ quote.text }}</p>
      <span class="wj-qcard-dot" aria-hidden="true">·</span>
      <span class="wj-qcard-src">{{ quote.sourceLabel }}</span>
      <span v-if="themes.length" class="wj-qcard-dot" aria-hidden="true">·</span>
      <ul v-if="themes.length" class="wj-qcard-themes">
        <li v-for="t in themes" :key="t" class="wj-qcard-theme">{{ t }}</li>
      </ul>
      <div class="wj-qcard-actions">
        <button
          v-if="allowExpand"
          type="button"
          class="wj-qcard-act"
          :aria-expanded="expanded"
          :aria-controls="expanded ? ctxId : undefined"
          :aria-label="expanded ? '收起语境' : '展开语境'"
          @click.stop="emit('toggle-context', quote)"
        >
          <span class="wj-qcard-act-long">{{ expanded ? '收起语境' : '展开语境' }}</span>
          <span class="wj-qcard-act-short" aria-hidden="true">{{ expanded ? '收起' : '语境' }}</span>
        </button>
        <button
          type="button"
          class="wj-qcard-act copy"
          :class="{ done: copied }"
          :aria-label="copied ? '已复制名句' : `复制名句：${quote.text}`"
          aria-live="polite"
          @click.stop="emit('copy', quote)"
        >
          {{ copied ? '已复制 ✓' : '复制' }}
        </button>
      </div>
    </div>

    <div v-else class="wj-qcard-body">
      <p class="wj-qcard-text">{{ quote.text }}</p>
      <p class="wj-qcard-src">{{ quote.sourceLabel }}</p>
      <ul v-if="themes.length" class="wj-qcard-themes">
        <li v-for="t in themes" :key="t" class="wj-qcard-theme">{{ t }}</li>
      </ul>

      <div class="wj-qcard-actions">
        <button
          v-if="allowExpand"
          type="button"
          class="wj-qcard-act"
          :aria-expanded="expanded"
          :aria-controls="expanded ? ctxId : undefined"
          :aria-label="expanded ? '收起语境' : '展开语境'"
          @click.stop="emit('toggle-context', quote)"
        >
          <span class="wj-qcard-act-long">{{ expanded ? '收起语境' : '展开语境' }}</span>
          <span class="wj-qcard-act-short" aria-hidden="true">{{ expanded ? '收起' : '语境' }}</span>
        </button>
        <button
          type="button"
          class="wj-qcard-act copy"
          :class="{ done: copied }"
          :aria-label="copied ? '已复制名句' : `复制名句：${quote.text}`"
          aria-live="polite"
          @click.stop="emit('copy', quote)"
        >
          {{ copied ? '已复制 ✓' : '复制' }}
        </button>
      </div>
    </div>

    <section v-if="expanded" :id="ctxId" class="wj-qcard-context" @click.stop>
      <p class="wj-qcard-ctx-label">适用场景</p>
      <p class="wj-qcard-ctx-scene">{{ quote.scene }}</p>

      <p v-if="contextLoading" class="wj-qcard-ctx-loading">正在加载原诗语境…</p>
      <p v-else-if="contextError" class="wj-qcard-ctx-error">语境加载失败（{{ contextError }}）</p>
      <template v-else-if="context">
        <p class="wj-qcard-ctx-label">原诗语境</p>
        <p class="wj-qcard-ctx-poem">{{ context }}</p>
      </template>

      <div class="wj-qcard-ctx-meta">
        <span v-if="quote.dynasty">{{ quote.dynasty }}</span>
        <span v-if="quote.stageLabel">{{ quote.stageLabel }}</span>
        <span v-if="quote.theme.length">主题：{{ quote.theme.join(' · ') }}</span>
        <a v-if="quote.workRoute" :href="quote.workRoute" @click.stop>作品词条 →</a>
      </div>
    </section>
  </article>
</template>

<style scoped>
.wj-qcard {
  position: relative;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.wj-qcard:hover {
  transform: translateY(-2px);
  box-shadow: var(--wj-shadow-hover);
}
.wj-qcard.open {
  box-shadow: var(--wj-shadow-hover);
}
.wj-qcard:focus-within {
  border-color: var(--wj-accent);
  box-shadow: var(--wj-shadow-hover);
}

/* 整卡导航层：不嵌套在正文里，复制/展开按钮浮于其上 */
.wj-qcard-hit {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
}
.wj-qcard-hit:focus-visible {
  outline: 2px solid var(--wj-accent);
  outline-offset: -4px;
}

/* ── 画廊 / 主题墙 ─────────────────────────────────────── */
.wj-qcard--gallery,
.wj-qcard--wall {
  display: flex;
  flex-direction: column;
  border-top: 3px solid var(--wj-accent);
}
.wj-qcard--gallery {
  padding: 12px 16px 11px;
}
.wj-qcard--wall {
  padding: 11px 14px 10px;
  box-shadow: var(--wj-shadow);
}
.wj-qcard-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.wj-qcard-text {
  margin: 0;
  font-family: var(--wj-font-poem);
  color: var(--wj-ink);
  text-align: center;
  text-wrap: balance;
  overflow-wrap: break-word;
}
.wj-qcard-text::before {
  content: '「';
  color: var(--wj-accent);
}
.wj-qcard-text::after {
  content: '」';
  color: var(--wj-accent);
}
.wj-qcard--gallery .wj-qcard-text {
  box-sizing: border-box;
  padding: 2px 2px 0;
  font-size: clamp(20px, 1.9vw, 25px);
  line-height: 1.55;
  min-height: calc(1.55em * 3 + 2px);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}
.wj-qcard--wall .wj-qcard-text {
  font-size: clamp(17px, 1.35vw, 20px);
  line-height: 1.5;
  min-height: calc(1.5em * 3);
  text-align: left;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.wj-qcard-src {
  margin: 0;
  color: var(--wj-ink-2);
  font-size: 12.5px;
  line-height: 1.4;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wj-qcard--wall .wj-qcard-src {
  text-align: left;
  font-size: 12px;
}

.wj-qcard-themes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.wj-qcard--wall .wj-qcard-themes {
  justify-content: flex-start;
}
.wj-qcard-theme {
  padding: 0 8px;
  line-height: 20px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 11px;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.wj-qcard-actions {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed var(--wj-line-soft);
}
.wj-qcard-act {
  padding: 4px 11px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 11.5px;
  line-height: 1.4;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.wj-qcard-act:hover {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}
.wj-qcard-act-short {
  display: none;
}
.wj-qcard-act.copy {
  margin-left: auto;
}
.wj-qcard-act.done {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
  background: var(--wj-accent-tint);
}

/* ── 列表 ─────────────────────────────────────────────── */
.wj-qcard--list {
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
}
.wj-qcard--list:hover {
  transform: translateY(-1px);
}
.wj-qcard-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 48px;
  padding: 8px 12px 8px 14px;
}
.wj-qcard--list .wj-qcard-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 16px;
  line-height: 1.5;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wj-qcard--list .wj-qcard-src {
  flex: 0 1 auto;
  max-width: 30%;
  font-size: 12px;
  text-align: right;
}
.wj-qcard--list .wj-qcard-themes {
  flex: 0 0 auto;
  flex-wrap: nowrap;
}
.wj-qcard--list .wj-qcard-actions {
  flex: 0 0 auto;
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.wj-qcard-dot {
  flex: none;
  color: var(--wj-ink-3);
  font-size: 12px;
}

/* ── 卡内语境（默认收起） ───────────────────────────────── */
.wj-qcard-context {
  position: relative;
  z-index: 2;
  margin-top: 10px;
  padding: 10px 12px 11px;
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-accent-tint);
}
.wj-qcard--list .wj-qcard-context {
  margin: 0 12px 11px 14px;
}
.wj-qcard-ctx-label {
  margin: 0 0 3px;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  letter-spacing: var(--wj-label-tracking, 0.08em);
}
.wj-qcard-ctx-scene,
.wj-qcard-ctx-poem,
.wj-qcard-ctx-loading,
.wj-qcard-ctx-error {
  margin: 0;
}
.wj-qcard-ctx-scene {
  color: var(--wj-ink-2);
  font-size: 12.5px;
  line-height: 1.7;
}
.wj-qcard-ctx-poem {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px dashed var(--wj-line);
  color: var(--wj-ink);
  font-family: var(--wj-font-poem);
  font-size: 14.5px;
  line-height: 1.8;
  white-space: pre-line;
}
.wj-qcard-ctx-loading,
.wj-qcard-ctx-error {
  margin-top: 7px;
  color: var(--wj-ink-2);
  font-size: 12px;
}
.wj-qcard-ctx-error {
  color: var(--wj-accent);
}
.wj-qcard-ctx-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 9px;
  padding-top: 7px;
  border-top: 1px dashed var(--wj-line);
  color: var(--wj-ink-3);
  font-size: 11px;
}
.wj-qcard-ctx-meta a {
  margin-left: auto;
  color: var(--wj-accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
}
.wj-qcard-ctx-meta a:hover {
  border-bottom-color: var(--wj-accent);
}

/* ── 响应式 ───────────────────────────────────────────── */
@media (max-width: 760px) {
  .wj-qcard--gallery {
    padding: 12px 14px 11px;
  }
  .wj-qcard--gallery .wj-qcard-text {
    font-size: 21px;
    min-height: calc(1.55em * 2);
    -webkit-line-clamp: 4;
  }
  .wj-qcard-row {
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: 9px 11px 9px 12px;
  }
  .wj-qcard--list .wj-qcard-text {
    flex: 1 1 100%;
    font-size: 15px;
  }
  .wj-qcard--list .wj-qcard-src {
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
    text-align: left;
  }
  .wj-qcard--list .wj-qcard-act-long {
    display: none;
  }
  .wj-qcard--list .wj-qcard-act-short {
    display: inline;
  }
  .wj-qcard-dot {
    display: none;
  }
  .wj-qcard--list .wj-qcard-actions {
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wj-qcard,
  .wj-qcard-act {
    transition: none;
  }
  .wj-qcard:hover,
  .wj-qcard--list:hover {
    transform: none;
  }
}
</style>
