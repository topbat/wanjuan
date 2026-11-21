<script setup lang="ts">
import { computed } from 'vue'

/**
 * 万卷 · 通用胶囊筛选条（多维、带计数、可清除）
 *
 * 用法：
 *   <WjFilterBar
 *     :groups="[{ key: 'field', label: '语义场', options: [{ value: '勤奋', label: '勤奋', count: 23 }] }]"
 *     v-model="selected"        // Record<string, string[]>，同维 OR、跨维 AND
 *     :total="filtered.length"
 *     @change="onFilterChange"
 *   />
 * 说明：计数由调用方计算（对当前「其他维度」的筛选结果做统计），组件只负责渲染与交互。
 * 规范见 docs/ui-patterns.md。
 */
const props = defineProps<{
  groups: Array<{
    key: string
    label: string
    options: Array<{ value: string; label?: string; count?: number }>
    collapsible?: boolean
  }>
  modelValue: Record<string, string[]>
  total?: number
  unit?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, string[]>): void
  (e: 'change', v: Record<string, string[]>): void
}>()

function toggle(key: string, value: string) {
  const next: Record<string, string[]> = { ...props.modelValue }
  const cur = new Set(next[key] ?? [])
  cur.has(value) ? cur.delete(value) : cur.add(value)
  next[key] = [...cur]
  if (!next[key].length) delete next[key]
  emit('update:modelValue', next)
  emit('change', next)
}

function clearAll() {
  emit('update:modelValue', {})
  emit('change', {})
}

function clearOne(key: string, value: string) {
  toggle(key, value)
}

const hasAny = computed(() => Object.values(props.modelValue ?? {}).some((v) => v?.length))
const selectedChips = computed(() => {
  const out: Array<{ key: string; value: string; label: string }> = []
  for (const g of props.groups) {
    for (const v of props.modelValue?.[g.key] ?? []) {
      const opt = g.options.find((o) => o.value === v)
      out.push({ key: g.key, value: v, label: opt?.label ?? v })
    }
  }
  return out
})
</script>

<template>
  <div class="wj-fb">
    <div v-for="g in groups" :key="g.key" class="wj-fb-row">
      <span class="wj-fb-label">{{ g.label }}</span>
      <div class="wj-fb-chips" role="group" :aria-label="g.label">
        <button
          v-for="o in g.options"
          :key="o.value"
          type="button"
          class="wj-chip"
          :class="{ on: (modelValue[g.key] ?? []).includes(o.value), zero: (o.count ?? 1) === 0 }"
          :aria-pressed="(modelValue[g.key] ?? []).includes(o.value)"
          :disabled="(o.count ?? 1) === 0"
          @click="toggle(g.key, o.value)"
        >
          {{ o.label ?? o.value }}<span v-if="o.count !== undefined" class="wj-chip-n">{{ o.count }}</span>
        </button>
      </div>
    </div>

    <div class="wj-fb-selected">
      <template v-if="hasAny">
        <span class="wj-fb-label">已选</span>
        <button
          v-for="c in selectedChips"
          :key="c.key + ':' + c.value"
          type="button"
          class="wj-chip on"
          :aria-label="`移除筛选 ${c.label}`"
          @click="clearOne(c.key, c.value)"
        >
          {{ c.label }} <span class="wj-chip-x">×</span>
        </button>
        <button type="button" class="wj-fb-clear" @click="clearAll">清除全部</button>
      </template>
      <span class="wj-fb-total" aria-live="polite">
        共 <b>{{ total ?? 0 }}</b> {{ unit ?? '条' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.wj-fb {
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  padding: 12px 14px 8px;
  margin: 14px 0;
}
.wj-fb-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0;
}
.wj-fb-label {
  flex: 0 0 auto;
  font-size: 12px;
  letter-spacing: var(--wj-label-tracking, 0.08em);
  color: var(--wj-ink-3);
  padding-top: 7px;
  min-width: 3.5em;
}
.wj-fb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 118px;
  overflow-y: auto;
}
.wj-fb-selected {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  border-top: 1px solid var(--wj-line);
  margin-top: 8px;
  padding-top: 10px;
}
.wj-fb-clear {
  font-size: 12px;
  color: var(--wj-accent);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.wj-fb-total {
  margin-left: auto;
  font-size: 13px;
  color: var(--wj-ink-2);
}
.wj-fb-total b { color: var(--wj-accent); font-size: 15px; }
@media (max-width: 700px) {
  .wj-fb-row { flex-direction: column; gap: 6px; }
  .wj-fb-label { padding-top: 0; }
}
</style>
