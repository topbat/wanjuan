<script setup lang="ts">
/**
 * 万卷 · 相关内容（词条页底部）
 *
 * 目的：把"单篇阅读"变成"可继续探索的网络"——读者看完一首诗，能顺着
 * 同作者、同题材、同意象、相关名句继续读下去，而不是走到死路。
 *
 * 数据：/indexes/{poems,idioms,quotes}.json（首次使用时并行拉取并缓存）
 * 显示：最多 4 组卡片，每组最多 6 条；无相关项时整块不渲染。
 */
import { computed, onMounted, ref } from 'vue'
import { useData, withBase } from 'vitepress'

type Poem = {
  id: string; title: string; author: string; dynasty: string; genre: string
  form: string; imagery: string[]; imageryHits?: string[]; srcPath: string
}
type Idiom = {
  id: string; word: string; meaning: string; semanticField: string
  synonyms: string[]; antonyms: string[]; srcPath: string
}
type Quote = {
  id: string; text: string; author: string; work?: string | null
  theme: string[]; dynasty: string; srcPath: string
}

const { page, frontmatter } = useData()

const poems = ref<Poem[]>([])
const idioms = ref<Idiom[]>([])
const quotes = ref<Quote[]>([])
const ready = ref(false)

// 按词条类型按需加载，避免每个词条页都拉三个索引（成语/名句页可省 300–600KB）
const cache = new Map<string, Promise<any[]>>()
function getIndex(name: string): Promise<any[]> {
  if (!cache.has(name)) {
    const url = `${import.meta.env.BASE_URL}indexes/${name}`
    cache.set(name, fetch(url).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => d.items ?? []).catch(() => []))
  }
  return cache.get(name)!
}
async function load() {
  if (ready.value) return
  const k = kind.value
  if (k === 'poems') {
    const [p, q] = await Promise.all([getIndex('poems.json'), getIndex('quotes.json')])
    poems.value = p; quotes.value = q
  } else if (k === 'idioms') {
    idioms.value = await getIndex('idioms.json')
  } else if (k === 'quotes') {
    quotes.value = await getIndex('quotes.json')
  }
  ready.value = true
}

// relativePath 已由 rewrites 归一（无 content/ 前缀）：poems/唐/李白/静夜思
const rel = computed(() => (page.value.relativePath || '').replace(/\.md$/, ''))
const kind = computed(() => {
  const parts = rel.value.split('/').filter(Boolean)
  if (parts[0] === 'content') return parts[1] ?? ''
  return ['poems', 'idioms', 'quotes', 'authors', 'imagery'].includes(parts[0]) ? parts[0] : ''
})
const currentId = computed(() => String(frontmatter.value.id ?? ''))

const route = (srcPath: string) => withBase(srcPath.replace(/^content\//, '').replace(/\.md$/, ''))

/** 作品：同作者 / 同题材 / 同意象 / 相关名句 */
const poemGroups = computed(() => {
  const me = poems.value.find((p) => p.id === currentId.value)
  if (!me) return []
  const groups: Array<{ title: string; hint: string; items: Array<{ key: string; title: string; sub: string; link: string }> }> = []

  const sameAuthor = poems.value
    .filter((p) => p.author === me.author && p.id !== me.id)
    .slice(0, 6)
    .map((p) => ({ key: p.id, title: p.title, sub: `${p.dynasty} · ${p.form ?? ''}`, link: route(p.srcPath) }))
  if (sameAuthor.length) groups.push({ title: `同为 ${me.author} 所作`, hint: '顺着作者读', items: sameAuthor })

  const sameGenre = poems.value
    .filter((p) => p.genre && p.genre === me.genre && p.id !== me.id)
    .slice(0, 6)
    .map((p) => ({ key: p.id, title: p.title, sub: `${p.author} · ${p.dynasty}`, link: route(p.srcPath) }))
  if (me.genre && me.genre !== '待归类' && sameGenre.length) {
    groups.push({ title: `同题材 · ${me.genre}`, hint: '对比着读', items: sameGenre })
  }

  const imageryKey = me.imagery?.[0] ?? me.imageryHits?.[0]
  if (imageryKey) {
    const sameImagery = poems.value
      .filter((p) => p.id !== me.id && (p.imagery ?? []).includes(imageryKey))
      .slice(0, 6)
      .map((p) => ({ key: p.id, title: p.title, sub: `${p.author} · ${p.dynasty}`, link: route(p.srcPath) }))
    if (sameImagery.length) groups.push({ title: `同写「${imageryKey}」`, hint: '意象脉络', items: sameImagery })
  }

  const relatedQuotes = quotes.value
    .filter((q) => q.work === me.id || (q.author === me.author && q.work !== me.id))
    .slice(0, 4)
    .map((q) => ({ key: q.id, title: q.text, sub: `${q.author} · ${q.theme?.join('/') ?? ''}`, link: route(q.srcPath) }))
  if (relatedQuotes.length) groups.push({ title: '相关名句', hint: '可直接引用', items: relatedQuotes })

  return groups
})

/** 成语：同语义场 / 近义 / 反义 */
const idiomGroups = computed(() => {
  const me = idioms.value.find((i) => i.id === currentId.value || i.word === frontmatter.value.word)
  if (!me) return []
  const groups = []
  const sameField = idioms.value
    .filter((i) => i.id !== me.id && i.semanticField && i.semanticField === me.semanticField)
    .slice(0, 6)
    .map((i) => ({ key: i.id, title: i.word, sub: i.meaning?.slice(0, 24) ?? '', link: route(i.srcPath) }))
  if (sameField.length) groups.push({ title: `同语义场 · ${me.semanticField}`, hint: '辨析近义', items: sameField })

  const relItems = (words: string[], title: string, hint: string) => {
    const items = (words ?? [])
      .map((w) => idioms.value.find((x) => x.word === w))
      .filter(Boolean)
      .map((x: any) => ({ key: x.id, title: x.word, sub: x.meaning?.slice(0, 24) ?? '', link: route(x.srcPath) }))
    if (items.length) groups.push({ title, hint, items })
  }
  relItems(me.synonyms, '近义成语', '换一个说法')
  relItems(me.antonyms, '反义成语', '对照记忆')
  return groups
})

/** 名句：同主题 / 同作者 */
const quoteGroups = computed(() => {
  const me = quotes.value.find((q) => q.id === currentId.value || q.text === frontmatter.value.text)
  if (!me) return []
  const groups = []
  const theme = me.theme?.[0]
  if (theme) {
    const same = quotes.value
      .filter((q) => q.id !== me.id && (q.theme ?? []).includes(theme))
      .slice(0, 6)
      .map((q) => ({ key: q.id, title: q.text, sub: q.author, link: route(q.srcPath) }))
    if (same.length) groups.push({ title: `同主题 · ${theme}`, hint: '一组素材', items: same })
  }
  const byAuthor = quotes.value
    .filter((q) => q.id !== me.id && q.author === me.author)
    .slice(0, 6)
    .map((q) => ({ key: q.id, title: q.text, sub: q.dynasty, link: route(q.srcPath) }))
  if (byAuthor.length) groups.push({ title: `同为 ${me.author} 所写`, hint: '作者风格', items: byAuthor })
  return groups
})

const groups = computed(() => {
  if (kind.value === 'poems') return poemGroups.value
  if (kind.value === 'idioms') return idiomGroups.value
  if (kind.value === 'quotes') return quoteGroups.value
  return []
})

/** 记录最近浏览，供首页「继续学习」使用 */
function recordVisit() {
  if (!kind.value || !currentId.value) return
  const title = String(frontmatter.value.title ?? frontmatter.value.word ?? frontmatter.value.text ?? '')
  if (!title) return
  const link = withBase(`/${rel.value.replace(/^content\//, '')}`)
  try {
    const raw = localStorage.getItem('wj-recent')
    const list: Array<{ id: string; title: string; type: string; link: string; at: number }> =
      raw ? JSON.parse(raw) : []
    const next = [{ id: currentId.value, title, type: kind.value, link, at: Date.now() },
      ...list.filter((x) => x.id !== currentId.value)].slice(0, 8)
    localStorage.setItem('wj-recent', JSON.stringify(next))
  } catch {}
}

onMounted(() => {
  if (kind.value) {
    load()
    recordVisit()
  }
})
</script>

<template>
  <section v-if="ready && groups.length" class="wj-related" aria-label="相关内容">
    <h2 class="wj-related-title">继续探索</h2>
    <div class="wj-related-grid">
      <div v-for="g in groups" :key="g.title" class="wj-related-group">
        <div class="wj-related-head">
          <h3>{{ g.title }}</h3>
          <span>{{ g.hint }}</span>
        </div>
        <ul>
          <li v-for="it in g.items" :key="it.key">
            <a :href="it.link">{{ it.title }}</a>
            <small v-if="it.sub">{{ it.sub }}</small>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wj-related {
  margin: 34px 0 8px;
  padding-top: 18px;
  border-top: 1px solid var(--wj-line);
}
.wj-related-title {
  margin: 0 0 14px;
  font-size: 13px;
  letter-spacing: var(--wj-label-tracking, .12em);
  color: var(--wj-ink-3);
  font-weight: 600;
  border: 0;
  padding: 0;
}
.wj-related-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
}
.wj-related-group {
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  padding: 12px 14px;
}
.wj-related-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.wj-related-head h3 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--wj-ink);
  border: 0;
  padding: 0;
}
.wj-related-head span {
  font-size: 11px;
  color: var(--wj-ink-3);
  white-space: nowrap;
}
.wj-related-group ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.wj-related-group li {
  padding: 5px 0;
  border-top: 1px dashed var(--wj-line-soft);
}
.wj-related-group li:first-child { border-top: 0; padding-top: 0; }
.wj-related-group a {
  display: block;
  font-size: 13.5px;
  color: var(--wj-ink);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color .15s ease;
}
.wj-related-group a:hover { color: var(--wj-accent); }
.wj-related-group small {
  display: block;
  margin-top: 1px;
  font-size: 11.5px;
  color: var(--wj-ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
