<script setup lang="ts">
/**
 * 万卷 · 词条页面包屑
 * 依据当前路由推导层级：
 *   作品  /poems/<朝代>/<作者>/<篇名>  → 首页 / 作品 / 唐 / 李白 / 静夜思
 *   成语  /idioms/<成语>              → 首页 / 成语库 / 亡羊补牢
 *   名句  /quotes/<名句>              → 首页 / 名句库 / …
 *   作者  /authors/<作者>             → 首页 / 作者 / 李白
 *   意象  /imagery/<意象>             → 首页 / 意象 / 月
 * 仅在详情页显示；列表页与自定义组件页不显示。
 */
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'

const { page } = useData()

const CRUMB_ROOTS: Record<string, { label: string; link: string }> = {
  poems: { label: '作品', link: '/stage/primary' },
  idioms: { label: '成语库', link: '/idioms/' },
  quotes: { label: '名句库', link: '/quotes/' },
  authors: { label: '作者', link: '/explore/graph' },
  imagery: { label: '意象', link: '/explore/imagery' },
}

const crumbs = computed(() => {
  const rel = (page.value.relativePath || '').replace(/\.md$/, '')
  const parts = rel.split('/').filter(Boolean)
  const head = parts[0]
  const root = CRUMB_ROOTS[head]
  // 只在「分类/具体条目」层级显示（如 poems/唐/李白/静夜思 至少 4 段）
  const isDetail =
    (head === 'poems' && parts.length >= 4) ||
    (['idioms', 'quotes', 'authors', 'imagery'].includes(head) && parts.length >= 2)
  if (!root || !isDetail) return []

  const list: Array<{ label: string; link?: string }> = [{ label: '首页', link: '/' }]
  list.push({ label: root.label, link: root.link })

  if (head === 'poems') {
    const [, dynasty, author, title] = parts
    // 朝代/作者暂无可跳转的聚合页，仅作文本层级
    list.push({ label: dynasty })
    list.push({ label: author })
    list.push({ label: title })
  } else {
    list.push({ label: parts[parts.length - 1] })
  }
  return list
})
</script>

<template>
  <nav v-if="crumbs.length" class="wj-crumbs" aria-label="面包屑">
    <ol>
      <li v-for="(c, i) in crumbs" :key="i">
        <a v-if="c.link" :href="withBase(c.link)">{{ c.label }}</a>
        <span v-else aria-current="page">{{ c.label }}</span>
        <span v-if="i < crumbs.length - 1" class="wj-crumbs-sep" aria-hidden="true">/</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.wj-crumbs {
  margin: 0 0 8px;
  font-size: 12.5px;
  color: var(--wj-ink-3);
}
.wj-crumbs ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.wj-crumbs li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.wj-crumbs a {
  color: var(--wj-ink-2);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: color .15s ease, border-color .15s ease;
}
.wj-crumbs a:hover {
  color: var(--wj-accent);
  border-bottom-color: var(--wj-accent);
}
.wj-crumbs [aria-current='page'] {
  color: var(--wj-ink);
  font-weight: 600;
  max-width: 22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wj-crumbs-sep { color: var(--wj-line); }
@media (max-width: 700px) {
  .wj-crumbs { font-size: 12px; }
  .wj-crumbs [aria-current='page'] { max-width: 12em; }
}
</style>
