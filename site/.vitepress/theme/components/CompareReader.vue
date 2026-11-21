<script setup lang="ts">
// 万卷 · 对比阅读生成器（同题材异写，并排对照）
// 数据源：/indexes/poems.json（题材聚合、元数据对照）
// 原文：按 rewrites 规则回源到本站词条页（SSG 完整 HTML），
//       DOMParser 抽取「## 原文」区块；加载失败时降级为提示 + 词条链接。
// 预置组与「随机来一组」均由数据动态生成，不硬编码库内不存在的题材组合。
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
  curriculum?: { stage?: string; grade?: number; semester?: string }
  srcPath: string
}

const BASE = import.meta.env.BASE_URL
const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }

const poems = ref<Poem[]>([])
const loading = ref(true)
const failed = ref('')

const activeGenre = ref('')
const selectedIds = ref<string[]>([])
const compared = ref(false)
const texts = ref<Record<string, string>>({})
const textsPending = ref<string[]>([])

/** 题材列表（计数降序） */
const genres = computed(() => {
  const counts = new Map<string, number>()
  for (const p of poems.value) counts.set(p.genre, (counts.get(p.genre) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
})

const genrePoems = computed(() =>
  activeGenre.value ? poems.value.filter((p) => p.genre === activeGenre.value) : [],
)

const selectedPoems = computed(() =>
  selectedIds.value.map((id) => poems.value.find((p) => p.id === id)).filter((p): p is Poem => !!p),
)

/** 预置经典组：作品 ≥2 篇的题材，按数据动态生成至多 3 组（每组取前 4 篇） */
const presetGroups = computed(() =>
  genres.value
    .filter((g) => g.count >= 2)
    .slice(0, 3)
    .map((g) => ({
      genre: g.name,
      count: g.count,
      ids: poems.value
        .filter((p) => p.genre === g.name)
        .slice(0, Math.min(4, g.count))
        .map((p) => p.id),
    })),
)

function toRoute(srcPath: string) {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

function stageText(p: Poem): string {
  const st = p.curriculum?.stage
  if (!st) return '未标注'
  const label = STAGE_LABEL[st] ?? st
  return p.curriculum?.grade ? `${label} ${p.curriculum.grade} 年级` : label
}

function toggleSelect(id: string) {
  compared.value = false
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else if (selectedIds.value.length < 4) selectedIds.value.push(id)
}

function selectGenre(name: string) {
  activeGenre.value = name
  selectedIds.value = []
  compared.value = false
}

/** 从词条页（SSG HTML）抽取「## 原文」区块 */
async function fetchText(p: Poem): Promise<string> {
  const cached = pageTextCache.get(p.id)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(toRoute(p.srcPath))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
    const root = doc.querySelector('.vp-doc') ?? doc.body
    const heads = [...root.querySelectorAll('h2')]
    const h = heads.find((el) => el.id === '原文' || el.textContent?.trim() === '原文')
    if (!h) throw new Error('未找到「原文」区块')
    const lines: string[] = []
    let el = h.nextElementSibling as HTMLElement | null
    while (el && !(el.tagName === 'H2')) {
      if (el.tagName === 'P') lines.push(el.textContent?.trim() ?? '')
      el = el.nextElementSibling as HTMLElement | null
    }
    const text = lines.filter(Boolean).join('\n')
    if (!text) throw new Error('原文为空')
    pageTextCache.set(p.id, text)
    return text
  } catch {
    pageTextCache.set(p.id, '') // 失败缓存，避免重复请求
    return ''
  }
}
const pageTextCache = new Map<string, string>()

/** 生成对照：抓取所选作品原文（失败降级为词条链接提示） */
async function generate() {
  if (selectedPoems.value.length < 2) return
  compared.value = true
  textsPending.value = selectedPoems.value.map((p) => p.id)
  for (const p of selectedPoems.value) {
    texts.value[p.id] = await fetchText(p)
    textsPending.value = textsPending.value.filter((id) => id !== p.id)
  }
}

/** 应用一组作品（预置组 / 随机组） */
function applyGroup(ids: string[]) {
  selectedIds.value = [...ids]
  const first = poems.value.find((p) => p.id === ids[0])
  if (first) activeGenre.value = first.genre
  generate()
}

/** 随机来一组：随机选一个作品 ≥2 篇的题材，随机取 2~4 篇 */
function randomGroup() {
  const pool = genres.value.filter((g) => g.count >= 2)
  if (!pool.length) return
  const g = pool[Math.floor(Math.random() * pool.length)]
  const list = poems.value.filter((p) => p.genre === g.name)
  const shuffled = [...list].sort(() => Math.random() - 0.5)
  applyGroup(shuffled.slice(0, Math.min(4, Math.max(2, shuffled.length))).map((p) => p.id))
}

onMounted(async () => {
  try {
    const res = await fetch(`${BASE}indexes/poems.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    poems.value = data.items ?? []
    activeGenre.value = genres.value[0]?.name ?? ''
  } catch (err: any) {
    failed.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="wj-cmp">
    <p v-if="loading" class="wj-note">正在加载作品数据（/indexes/poems.json）…</p>
    <p v-else-if="failed" class="wj-note">
      作品数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引。
    </p>
    <template v-else>
      <!-- 步骤 1：选题材 -->
      <section class="wj-step">
        <h4>① 选题材</h4>
        <div class="wj-toolbar">
          <button
            v-for="g in genres"
            :key="g.name"
            :class="{ active: g.name === activeGenre }"
            @click="selectGenre(g.name)"
          >
            {{ g.name }}（{{ g.count }}）
          </button>
        </div>
      </section>

      <!-- 快捷组：预置 + 随机（按数据动态出现） -->
      <section v-if="presetGroups.length || genres.some((g) => g.count >= 2)" class="wj-step">
        <h4>快捷成组</h4>
        <div class="wj-toolbar">
          <button
            v-for="g in presetGroups"
            :key="g.genre"
            class="wj-preset"
            @click="applyGroup(g.ids)"
          >
            预置 · 「{{ g.genre }}」{{ g.count }} 篇对读
          </button>
          <button class="wj-random" @click="randomGroup">🎲 随机来一组</button>
        </div>
      </section>

      <!-- 步骤 2：勾选 2-4 篇 -->
      <section class="wj-step">
        <h4>
          ② 勾选对照篇目
          <span class="wj-step-meta">已选 {{ selectedIds.length }} / 4（至少 2 篇）</span>
        </h4>
        <div v-if="genrePoems.length" class="wj-pick-grid">
          <button
            v-for="p in genrePoems"
            :key="p.id"
            class="wj-pick"
            :class="{ picked: selectedIds.includes(p.id) }"
            @click="toggleSelect(p.id)"
          >
            <b>{{ p.title }}</b>
            <span class="wj-pick-meta">
              {{ p.author }} · {{ p.dynasty }} · {{ p.form }} · {{ stageText(p) }}
            </span>
            <span v-if="p.imagery?.length" class="wj-pick-imagery">
              意象：<i v-for="im in p.imagery" :key="im">{{ im }}</i>
            </span>
          </button>
        </div>
        <p v-else class="wj-note">数据整理中：该题材暂无作品。</p>
        <div class="wj-toolbar">
          <button class="wj-go" :disabled="selectedIds.length < 2" @click="generate()">
            生成对照（{{ selectedIds.length }} 篇）
          </button>
        </div>
      </section>

      <!-- 步骤 3：并排对照卡 -->
      <section v-if="compared && selectedPoems.length" class="wj-step">
        <h4>③ 并排对照</h4>
        <div class="wj-cmp-grid">
          <div v-for="p in selectedPoems" :key="p.id" class="wj-cmp-card">
            <a :href="toRoute(p.srcPath)" class="wj-cmp-title">{{ p.title }}</a>
            <p class="wj-cmp-author">{{ p.author }} · {{ p.dynasty }}</p>
            <dl class="wj-cmp-dl">
              <div><dt>体裁</dt><dd>{{ p.form }}<template v-if="p.tune">（{{ p.tune }}）</template></dd></div>
              <div><dt>题材</dt><dd>{{ p.genre }}</dd></div>
              <div><dt>意象</dt><dd>
                <template v-if="p.imagery?.length">
                  <span v-for="im in p.imagery" :key="im" class="wj-pill">{{ im }}</span>
                </template>
                <template v-else>—</template>
              </dd></div>
              <div><dt>学段</dt><dd>{{ stageText(p) }}</dd></div>
            </dl>
            <div class="wj-cmp-text">
              <template v-if="textsPending.includes(p.id)">原文加载中…</template>
              <template v-else-if="texts[p.id]">{{ texts[p.id] }}</template>
              <template v-else>
                <span class="wj-note">原文暂不可得，</span>
                <a :href="toRoute(p.srcPath)">进入词条页查看 →</a>
              </template>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wj-step {
  margin-top: 18px;
}
.wj-step h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--wj-ink-2);
  letter-spacing: var(--wj-label-tracking);
}
.wj-step-meta {
  margin-left: 10px;
  font-size: 12px;
  color: var(--wj-ink-3);
  letter-spacing: normal;
}

.wj-preset,
.wj-random,
.wj-go {
  font-weight: 600;
}
.wj-random {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
}
.wj-go {
  background: var(--wj-accent);
  border-color: var(--wj-accent);
  color: var(--wj-card);
}
.wj-go:hover:not(:disabled) {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
  color: var(--wj-card);
}
.wj-go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 勾选卡片 */
.wj-pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}
.wj-pick {
  text-align: left;
  padding: 12px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  color: var(--wj-ink);
  font-family: var(--wj-font-display);
  cursor: pointer;
  transition: border-color 0.16s, box-shadow 0.16s;
}
.wj-pick:hover {
  border-color: var(--wj-ink-3);
}
.wj-pick.picked {
  border-color: var(--wj-accent);
  box-shadow: var(--wj-shadow-hover);
  background: var(--wj-accent-tint);
}
.wj-pick b {
  display: block;
  font-size: 15px;
  margin-bottom: 4px;
}
.wj-pick-meta {
  display: block;
  font-size: 12px;
  color: var(--wj-ink-3);
}
.wj-pick-imagery {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--wj-ink-2);
}
.wj-pick-imagery i {
  font-style: normal;
  margin-right: 6px;
  color: var(--wj-accent);
}

/* 对照卡 */
.wj-cmp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 14px;
}
.wj-cmp-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}
.wj-cmp-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--wj-ink);
  text-decoration: none;
  border-bottom: 2px solid var(--wj-accent);
  align-self: flex-start;
}
.wj-cmp-title:hover {
  color: var(--wj-accent);
}
.wj-cmp-author {
  margin: 0;
  font-size: 13px;
  color: var(--wj-ink-2);
}
.wj-cmp-dl {
  margin: 0;
  font-size: 13px;
}
.wj-cmp-dl > div {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--wj-line-soft);
}
.wj-cmp-dl > div:last-child {
  border-bottom: none;
}
.wj-cmp-dl dt {
  min-width: 3em;
  color: var(--wj-ink-3);
}
.wj-cmp-dl dd {
  margin: 0;
  color: var(--wj-ink);
}
.wj-pill {
  display: inline-block;
  margin-right: 4px;
  padding: 0 9px;
  border-radius: var(--wj-radius-pill);
  font-size: 12px;
  border: 1px solid var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-cmp-text {
  margin-top: 6px;
  padding: 12px;
  font-family: var(--wj-font-poem);
  font-size: 15px;
  line-height: 2;
  color: var(--wj-ink);
  background: var(--wj-bg-soft);
  border-radius: var(--wj-radius);
  white-space: pre-line;
  flex: 1;
}
</style>
