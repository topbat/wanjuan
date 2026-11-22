<script setup lang="ts">
/**
 * 万卷 · 面包屑（全站定位）
 *
 * 覆盖两类路径：
 *   内容词条  content/poems/<朝代>/<作者>/<篇名>.md → 首页 / 作品 / 唐 / 李白 / 静夜思
 *   站内页面  site/explore/graph.md              → 首页 / 探索 / 知识图谱
 *            site/quotes/index.md                → 首页 / 名句库
 * 首页本身不显示；词条页上层层级可点击。
 */
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'

const { page } = useData()

type Crumb = { label: string; link?: string }

const CONTENT_ROOTS: Record<string, { label: string; link: string }> = {
  poems: { label: '作品', link: '/stage/primary' },
  idioms: { label: '成语库', link: '/idioms/' },
  quotes: { label: '名句库', link: '/quotes/' },
  authors: { label: '作者', link: '/explore/graph' },
  imagery: { label: '意象', link: '/explore/imagery' },
}

/** 站内页面的段名 → 中文标签与入口 */
const SECTION_LABEL: Record<string, { label: string; link?: string }> = {
  explore: { label: '探索', link: '/explore/graph' },
  stage: { label: '学段', link: '/stage/primary' },
  idioms: { label: '成语库', link: '/idioms/' },
  quotes: { label: '名句库', link: '/quotes/' },
  review: { label: '今日复习', link: '/review/' },
  quiz: { label: '每日一卷', link: '/quiz/' },
  play: { label: '互动玩法', link: '/play/' },
  profile: { label: '素养画像', link: '/profile/' },
  timeline: { label: '时间轴', link: '/timeline/' },
  ask: { label: '问书库', link: '/ask/' },
}

/** 页面文件名 → 展示名（仅当没有更好来源时兜底） */
const PAGE_LABEL: Record<string, string> = {
  graph: '知识图谱',
  wordcloud: '主题词云',
  stats: '双轨统计',
  search: '高级检索',
  imagery: '意象枢纽',
  semantic: '成语语义场',
  compare: '对比阅读',
  'quotes-cards': '名句卡片',
  'genre-review': '题材校对',
  primary: '小学',
  junior: '初中',
  senior: '高中',
  index: '总览',
  mistakes: '错题本',
}

const crumbs = computed<Crumb[]>(() => {
  // 注意：VitePress 的 relativePath 是 rewrites 之后的路径（content/、site/ 前缀已被剥离）
  const parts = (page.value.relativePath || '').replace(/\.md$/, '').split('/').filter(Boolean)
  if (parts.length < 2) return []          // 首页/一级页面不显示
  if (parts[0] === 'index') return []

  const list: Crumb[] = [{ label: '首页', link: '/' }]
  const head = parts[0]

  // 内容词条：poems/<朝代>/<作者>/<篇名> 或 idioms/<成语>
  const croot = CONTENT_ROOTS[head]
  if (croot) {
    list.push({ label: croot.label, link: croot.link })
    if (head === 'poems') {
      const [, dynasty, author, title] = parts
      if (dynasty) list.push({ label: dynasty })
      if (author) list.push({ label: author })
      if (title) list.push({ label: title })
    } else {
      list.push({ label: parts[parts.length - 1] })
    }
    return list
  }

  // 站内页面：<section>/<page>
  const meta = SECTION_LABEL[head]
  if (!meta) return []
  list.push({ label: meta.label, link: meta.link })
  const leaf = parts[parts.length - 1]
  if (leaf && leaf !== 'index') list.push({ label: PAGE_LABEL[leaf] ?? leaf })
  return list
})
</script>

<template>
  <nav v-if="crumbs.length > 1" class="wj-crumbs" aria-label="面包屑">
    <ol>
      <li v-for="(c, i) in crumbs" :key="i">
        <a v-if="c.link && i < crumbs.length - 1" :href="withBase(c.link)">{{ c.label }}</a>
        <span v-else :aria-current="i === crumbs.length - 1 ? 'page' : undefined">{{ c.label }}</span>
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
.wj-crumbs a:hover { color: var(--wj-accent); border-bottom-color: var(--wj-accent); }
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
