<script setup lang="ts">
// 万卷 · 意象枢纽（一象多情：义项 / 高频例句 / 朝代热度 / 相关作品）
// 数据源：
//   /indexes/poems.json  —— 作品清单（imagery 标签聚合、作品回源链接）
//   /indexes/stats.json  —— imageryDist（意象分布兜底）
//   /indexes/graph.json  —— 意象节点全集（含 0 度意象，如「柳」「雁」）
//   content/imagery/<名>.md 的 frontmatter（senses / representative）：
//     索引暂未携带该字段，开发期经 GitHub raw 拉取源文件解析；
//     拉取失败或义项不全时降级为「义项整理中」。
import { computed, onMounted, ref } from 'vue'

type Poem = {
  id: string
  title: string
  author: string
  dynasty: string
  form: string
  tune?: string | null
  genre: string
  imagery: string[]
  curriculum?: { stage?: string; grade?: number }
  srcPath: string
}
type GraphNode = { id: string; label: string; type: string; degree: number; anchor?: string }
type Quote = { id: string; text: string; author: string; work?: string | null }
type Sense = { sense: string; weight: number }
type RepItem = { work?: string; line?: string }

const BASE = import.meta.env.BASE_URL
const RAW_BASE = 'https://raw.githubusercontent.com/topbat/wanjuan/main/'

const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }

const poems = ref<Poem[]>([])
const quotes = ref<Quote[]>([])
const imageryNodes = ref<GraphNode[]>([])
const imageryDist = ref<{ name: string; value: number }[]>([])
const loading = ref(true)
const failed = ref('')

const activeName = ref('')
const senses = ref<Sense[] | null>(null)
const sensesPending = ref(false)
const repLines = ref<Record<string, string>>({})

/** 意象全集：图谱意象节点 ∪ 诗歌索引标签 ∪ stats.imageryDist，计数以作品聚合优先 */
const imageryList = computed(() => {
  const counts = new Map<string, number>()
  for (const p of poems.value) for (const t of p.imagery ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  for (const d of imageryDist.value) counts.set(d.name, Math.max(counts.get(d.name) ?? 0, d.value))
  const nodeByName = new Map(imageryNodes.value.map((n) => [n.label, n]))
  const names = new Set<string>([...counts.keys(), ...nodeByName.keys()])
  return [...names]
    .map((name) => {
      const node = nodeByName.get(name)
      return {
        name,
        count: counts.get(name) ?? node?.degree ?? 0,
        nodeId: node?.id ?? '',
        anchor: node?.anchor ?? '',
      }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
})

const activeItem = computed(() => imageryList.value.find((i) => i.name === activeName.value) ?? null)

/** 当前意象的相关作品（即「高频例句」来源） */
const matchedPoems = computed(() =>
  activeName.value ? poems.value.filter((p) => (p.imagery ?? []).includes(activeName.value)) : [],
)

/** 高频例句 Top10：代表句优先（imagery md 的 representative），其次名句索引（work 关联） */
const topLines = computed(() => {
  const quoteByWork = new Map<string, Quote>()
  for (const q of quotes.value) if (q.work) quoteByWork.set(q.work, q)
  return matchedPoems.value.slice(0, 10).map((p) => ({
    poem: p,
    line: repLines.value[p.id] || quoteByWork.get(p.id)?.text || '',
  }))
})

/** 朝代热度：相关作品按朝代计数（纯 CSS 条形） */
const dynastyBars = computed(() => {
  const counts = new Map<string, number>()
  for (const p of matchedPoems.value) counts.set(p.dynasty, (counts.get(p.dynasty) ?? 0) + 1)
  const rows = [...counts.entries()].map(([dynasty, count]) => ({ dynasty, count }))
  rows.sort((a, b) => b.count - a.count)
  const max = rows[0]?.count ?? 1
  return rows.map((r) => ({ ...r, pct: Math.round((r.count / max) * 100) }))
})

/** srcPath → 站点路由（与 config.mts rewrite 一致，同 AdvancedSearch） */
function toRoute(srcPath: string) {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

/** 极简 frontmatter 解析：只取顶层标量 + senses / representative 两层列表 */
function parseFrontmatter(text: string): { senses?: Sense[]; representative?: RepItem[] } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const lists: Record<string, Record<string, string>[]> = {}
  let currentList: string | null = null
  let pending: Record<string, string> = {}
  const flush = () => {
    if (currentList && Object.keys(pending).length) {
      lists[currentList].push(pending)
      pending = {}
    }
  }
  for (const raw of m[1].split(/\r?\n/)) {
    const li = raw.match(/^\s+-\s+([\w_]+):\s*(.*)$/)
    if (li && currentList) {
      flush()
      pending = { [li[1]]: li[2] }
      continue
    }
    const sub = raw.match(/^\s+([\w_]+):\s*(.*)$/)
    if (sub && currentList) {
      pending[sub[1]] = sub[2]
      continue
    }
    flush()
    currentList = null
    const top = raw.match(/^([\w_]+):\s*(.*)$/)
    if (top && top[2].trim() === '' && (top[1] === 'senses' || top[1] === 'representative')) {
      currentList = top[1]
      lists[currentList] = []
    }
  }
  flush()
  const senses = (lists.senses ?? []).map((s) => ({
    sense: (s.sense ?? '').replace(/^['"]|['"]$/g, ''),
    weight: Number(s.weight) || 0,
  }))
  return { senses: senses.length ? senses : undefined, representative: lists.representative }
}

/** 拉取意象源文件（GitHub raw）解析义项与代表句；失败降级为「义项整理中」 */
async function loadSenses(anchor: string) {
  senses.value = null
  repLines.value = {}
  if (!anchor) {
    sensesPending.value = false
    return
  }
  sensesPending.value = true
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(RAW_BASE + encodeURI(anchor), { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const fm = parseFrontmatter(await res.text())
    senses.value = fm.senses?.length ? fm.senses : null
    const map: Record<string, string> = {}
    for (const r of fm.representative ?? []) if (r.work && r.line) map[r.work] = r.line
    repLines.value = map
  } catch {
    senses.value = null // 网络不可达 / 文件缺失：义项整理中
  } finally {
    sensesPending.value = false
  }
}

function openImagery(item: { name: string; anchor: string }) {
  activeName.value = item.name
  loadSenses(item.anchor)
}

onMounted(async () => {
  try {
    const [p1, p2, p3, p4] = await Promise.all([
      fetch(`${BASE}indexes/poems.json`),
      fetch(`${BASE}indexes/quotes.json`),
      fetch(`${BASE}indexes/graph.json`),
      fetch(`${BASE}indexes/stats.json`),
    ])
    if (!p1.ok) throw new Error(`poems.json HTTP ${p1.status}`)
    const d1 = await p1.json()
    poems.value = d1.items ?? []
    if (p2.ok) quotes.value = (await p2.json()).items ?? []
    if (p3.ok) {
      const g = await p3.json()
      imageryNodes.value = (g.nodes ?? []).filter((n: GraphNode) => n.type === 'imagery')
    }
    if (p4.ok) imageryDist.value = (await p4.json()).imageryDist ?? []
  } catch (err: any) {
    failed.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="wj-hub">
    <p v-if="loading" class="wj-note">正在加载意象数据（/indexes/poems.json 等）…</p>
    <p v-else-if="failed" class="wj-note">
      意象数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引。
    </p>
    <template v-else>
      <!-- 意象列表 -->
      <div v-if="imageryList.length" class="wj-hub-list">
        <button
          v-for="item in imageryList"
          :key="item.name"
          class="wj-hub-chip"
          :class="{ active: item.name === activeName }"
          @click="openImagery(item)"
        >
          {{ item.name }}
          <span class="wj-hub-count">{{ item.count }}</span>
        </button>
      </div>
      <p v-else class="wj-note">数据整理中：暂无意象标签，请先在作品 frontmatter 标注 imagery。</p>

      <!-- 意象详情 -->
      <div v-if="activeItem" class="wj-hub-detail">
        <div class="wj-hub-head">
          <h3 class="wj-hub-title">意象 · {{ activeItem.name }}</h3>
          <span class="wj-hub-meta">
            收录相关作品 {{ matchedPoems.length }} 篇
            <template v-if="activeItem.nodeId">
              ·
              <a :href="`${BASE}explore/graph?focus=${encodeURIComponent(activeItem.nodeId)}`">
                在图谱中查看 →
              </a>
            </template>
          </span>
        </div>

        <!-- 义项（一象多情） -->
        <section class="wj-hub-section">
          <h4>义项 · 一象多情</h4>
          <p v-if="sensesPending" class="wj-note">正在获取义项（GitHub raw 源文件）…</p>
          <ul v-else-if="senses" class="wj-senses">
            <li v-for="s in senses" :key="s.sense">
              <span class="wj-sense-name">{{ s.sense }}</span>
              <span class="wj-sense-bar"><i :style="{ width: Math.max(4, Math.round(s.weight * 100)) + '%' }"></i></span>
              <span class="wj-sense-weight">{{ Math.round(s.weight * 100) }}%</span>
            </li>
          </ul>
          <p v-else class="wj-note">义项整理中。</p>
        </section>

        <!-- 朝代热度 -->
        <section class="wj-hub-section">
          <h4>朝代热度</h4>
          <ul v-if="dynastyBars.length" class="wj-bars">
            <li v-for="(row, i) in dynastyBars" :key="row.dynasty">
              <span class="wj-bar-label">{{ row.dynasty }}</span>
              <span class="wj-bar-track">
                <i :style="{ width: row.pct + '%', background: `var(--wj-chart-${(i % 8) + 1})` }"></i>
              </span>
              <span class="wj-bar-value">{{ row.count }} 篇</span>
            </li>
          </ul>
          <p v-else class="wj-note">数据整理中：暂无该朝代的作品关联。</p>
        </section>

        <!-- 高频例句 Top10 -->
        <section class="wj-hub-section">
          <h4>高频例句 · Top 10</h4>
          <ol v-if="topLines.length" class="wj-lines">
            <li v-for="row in topLines" :key="row.poem.id">
              <p class="wj-line-text">{{ row.line || '（诗句摘录整理中）' }}</p>
              <a :href="toRoute(row.poem.srcPath)" class="wj-line-src">
                《{{ row.poem.title }}》 · {{ row.poem.author }}（{{ row.poem.dynasty }}）
              </a>
            </li>
          </ol>
          <p v-else class="wj-note">数据整理中：该意象的代表篇目收录中。</p>
        </section>

        <!-- 相关作品入口 -->
        <section class="wj-hub-section">
          <h4>相关作品</h4>
          <div v-if="matchedPoems.length" class="wj-works">
            <a v-for="p in matchedPoems" :key="p.id" :href="toRoute(p.srcPath)" class="wj-work-card">
              <b>{{ p.title }}</b>
              <span class="wj-work-meta">
                {{ p.author }} · {{ p.dynasty }} · {{ p.form }} · {{ p.genre }}
                <template v-if="p.curriculum?.stage">
                  · {{ STAGE_LABEL[p.curriculum.stage] ?? p.curriculum.stage }}
                </template>
              </span>
            </a>
          </div>
          <p v-else class="wj-note">
            数据整理中：含「{{ activeItem.name }}」的作品尚未收录，
            <template v-if="activeItem.anchor">
              可在
              <a :href="`${BASE}imagery/${encodeURIComponent(activeItem.name)}`" target="_blank">意象词条</a>
              中补充代表例句。
            </template>
          </p>
        </section>
      </div>

      <p v-else-if="imageryList.length" class="wj-note">点击上方意象，查看义项、高频例句、朝代热度与相关作品。</p>
    </template>
  </div>
</template>

<style scoped>
.wj-hub-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;
}
.wj-hub-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 14px;
  font-size: 15px;
  font-family: var(--wj-font-display);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  cursor: pointer;
  transition: all 0.16s;
}
.wj-hub-chip:hover {
  color: var(--wj-ink);
  border-color: var(--wj-ink-3);
}
.wj-hub-chip.active {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-hub-count {
  font-size: 12px;
  color: var(--wj-ink-3);
}
.wj-hub-chip.active .wj-hub-count {
  color: var(--wj-accent);
}

.wj-hub-detail {
  margin-top: 18px;
  padding: 18px 20px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}
.wj-hub-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--wj-line-soft);
  padding-bottom: 10px;
}
.wj-hub-title {
  margin: 0;
  font-size: 18px;
  letter-spacing: var(--wj-label-tracking);
}
.wj-hub-meta {
  font-size: 13px;
  color: var(--wj-ink-2);
}
.wj-hub-meta a {
  color: var(--wj-accent);
  text-decoration: none;
  font-weight: 600;
}
.wj-hub-section {
  margin-top: 18px;
}
.wj-hub-section h4 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--wj-ink-2);
  letter-spacing: var(--wj-label-tracking);
}

/* 义项 */
.wj-senses {
  list-style: none;
  padding: 0;
  margin: 0;
}
.wj-senses li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.wj-sense-name {
  min-width: 6.5em;
  font-size: 14px;
  color: var(--wj-ink);
}
.wj-sense-bar {
  flex: 1;
  height: 8px;
  background: var(--wj-bg-soft);
  border-radius: var(--wj-radius-pill);
  overflow: hidden;
}
.wj-sense-bar i {
  display: block;
  height: 100%;
  background: var(--wj-accent);
  border-radius: var(--wj-radius-pill);
}
.wj-sense-weight {
  min-width: 3.5em;
  text-align: right;
  font-size: 12px;
  color: var(--wj-ink-3);
}

/* 朝代热度条形图 */
.wj-bars {
  list-style: none;
  padding: 0;
  margin: 0;
}
.wj-bars li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 0;
}
.wj-bar-label {
  min-width: 4em;
  font-size: 14px;
  color: var(--wj-ink);
}
.wj-bar-track {
  flex: 1;
  height: 14px;
  background: var(--wj-bg-soft);
  border-radius: var(--wj-radius-pill);
  overflow: hidden;
}
.wj-bar-track i {
  display: block;
  height: 100%;
  border-radius: var(--wj-radius-pill);
  transition: width 0.4s ease;
}
.wj-bar-value {
  min-width: 4em;
  text-align: right;
  font-size: 12px;
  color: var(--wj-ink-3);
}

/* 例句 */
.wj-lines {
  margin: 0;
  padding-left: 1.4em;
}
.wj-lines li {
  padding: 6px 0;
  border-bottom: 1px dashed var(--wj-line-soft);
}
.wj-lines li:last-child {
  border-bottom: none;
}
.wj-line-text {
  margin: 0 0 2px;
  font-family: var(--wj-font-poem);
  font-size: 16px;
  color: var(--wj-ink);
}
.wj-line-src {
  font-size: 13px;
  color: var(--wj-accent);
  text-decoration: none;
}
.wj-line-src:hover {
  text-decoration: underline;
}

/* 相关作品 */
.wj-works {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.wj-work-card {
  display: block;
  padding: 10px 12px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  text-decoration: none;
  color: var(--wj-ink);
  transition: border-color 0.16s, box-shadow 0.16s;
}
.wj-work-card:hover {
  border-color: var(--wj-accent);
  box-shadow: var(--wj-shadow-hover);
}
.wj-work-card b {
  display: block;
  font-size: 15px;
  margin-bottom: 4px;
}
.wj-work-meta {
  font-size: 12px;
  color: var(--wj-ink-3);
}
</style>
