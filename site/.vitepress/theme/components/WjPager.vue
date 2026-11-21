<script setup lang="ts">
/**
 * 万卷 · 通用分页器
 * 用法：<WjPager :total="items.length" v-model:page="page" v-model:size="size" />
 * 规范见 docs/ui-patterns.md：内容型浏览用分页（非无限滚动），并播报结果数变化。
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  total: number
  page: number
  size?: number
  sizes?: number[]
  unit?: string
}>(), { size: 24, sizes: () => [12, 24, 48, 96], unit: '条' })

const emit = defineEmits<{
  (e: 'update:page', v: number): void
  (e: 'update:size', v: number): void
}>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.size)))

/** 页码序列：首尾 + 当前邻域，其余省略 */
const pages = computed<(number | '…')[]>(() => {
  const n = pageCount.value
  const cur = props.page
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  const set = new Set<number>([1, n, cur, cur - 1, cur + 1])
  const arr = [...set].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const x of arr) {
    if (prev && x - prev > 1) out.push('…')
    out.push(x)
    prev = x
  }
  return out
})

function go(p: number) {
  const t = Math.min(Math.max(1, p), pageCount.value)
  if (t !== props.page) emit('update:page', t)
}

function changeSize(e: Event) {
  const v = Number((e.target as HTMLSelectElement).value)
  emit('update:size', v)
  emit('update:page', 1)
}

const from = computed(() => (props.total ? (props.page - 1) * props.size + 1 : 0))
const to = computed(() => Math.min(props.page * props.size, props.total))
</script>

<template>
  <div class="wj-pager">
    <span class="wj-pager-info" aria-live="polite">
      第 <b>{{ from }}–{{ to }}</b> 条 / 共 <b>{{ total }}</b> {{ unit }}
    </span>
    <nav class="wj-pager-nav" aria-label="分页">
      <button type="button" class="wj-pager-btn" :disabled="page <= 1" aria-label="上一页" @click="go(page - 1)">‹</button>
      <template v-for="(p, i) in pages" :key="i + '-' + p">
        <span v-if="p === '…'" class="wj-pager-gap">…</span>
        <button
          v-else
          type="button"
          class="wj-pager-btn"
          :class="{ on: p === page }"
          :aria-current="p === page ? 'page' : undefined"
          @click="go(p as number)"
        >{{ p }}</button>
      </template>
      <button type="button" class="wj-pager-btn" :disabled="page >= pageCount" aria-label="下一页" @click="go(page + 1)">›</button>
    </nav>
    <label class="wj-pager-size">
      每页
      <select :value="size" @change="changeSize">
        <option v-for="s in sizes" :key="s" :value="s">{{ s }}</option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.wj-pager {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 14px 4px 4px;
  font-size: 13px;
  color: var(--wj-ink-2);
}
.wj-pager-info b { color: var(--wj-ink); }
.wj-pager-nav { display: flex; align-items: center; gap: 4px; }
.wj-pager-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--wj-ink-2);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: calc(var(--wj-radius) * 0.6);
  cursor: pointer;
  transition: all .15s ease;
}
.wj-pager-btn:hover:not(:disabled) { border-color: var(--wj-accent); color: var(--wj-accent); }
.wj-pager-btn.on { background: var(--wj-accent); border-color: var(--wj-accent); color: #fff; }
.wj-pager-btn:disabled { opacity: .4; cursor: default; }
.wj-pager-gap { padding: 0 4px; color: var(--wj-ink-3); }
.wj-pager-size select {
  margin-left: 4px;
  padding: 4px 6px;
  font-size: 13px;
  color: var(--wj-ink);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: 6px;
}
</style>
