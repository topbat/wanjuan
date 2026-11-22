<script setup lang="ts">
// 万卷 · 学段清单（按课标 stage 过滤 poems.json）
// 分组口径说明：导入作品的 grade 为占位值（课标未按年级分组，统一记 1/7/10），
// 按"年级"分组会把 62 篇全塞进一年级，误导读者；故默认按朝代分组，可切换体裁。
import { computed, onMounted, ref } from 'vue'

type Poem = {
  id: string
  title: string
  author: string
  dynasty: string
  form: string
  tune: string | null
  genre: string
  curriculum: { stage: string; grade: number; semester: string | null; recitation: boolean }
  srcPath: string
}

const props = defineProps<{ stage: 'primary' | 'junior' | 'senior' }>()

const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }

const loading = ref(true)
const failed = ref('')
const all = ref<Poem[]>([])
type GroupMode = 'dynasty' | 'form'
const mode = ref<GroupMode>('dynasty')

const DYNASTY_ORDER = ['先秦', '秦', '汉', '三国', '魏晋', '南北朝', '五代', '唐', '宋', '元', '明', '清', '近现代']

const groups = computed(() => {
  const map = new Map<string, Poem[]>()
  const keyOf = (p: Poem) => (mode.value === 'dynasty' ? p.dynasty || '待考' : p.form || '待归类')
  for (const p of all.value) {
    const k = keyOf(p)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(p)
  }
  const rank = (k: string) => {
    const i = DYNASTY_ORDER.indexOf(k)
    return i < 0 ? DYNASTY_ORDER.length : i
  }
  return [...map.entries()]
    .sort((a, b) => (mode.value === 'dynasty' ? rank(a[0]) - rank(b[0]) : b[1].length - a[1].length))
    .map(([key, poems]) => ({ key, poems: poems.sort((x, y) => x.title.localeCompare(y.title, 'zh')) }))
})

onMounted(async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/poems.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    all.value = (data.items ?? []).filter((p: Poem) => p.curriculum?.stage === props.stage)
    loading.value = false
  } catch (err: any) {
    loading.value = false
    failed.value = err?.message ?? String(err)
  }
})

function toRoute(p: Poem) {
  return encodeURI(`${import.meta.env.BASE_URL}${p.srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}
</script>

<template>
  <div>
    <p v-if="loading" class="wj-note">正在载入课标清单（/indexes/poems.json）…</p>
    <p v-else-if="failed" class="wj-note">
      清单加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引。
    </p>
    <template v-else>
      <p class="wj-note">
        当前收录 {{ all.length }} 篇{{ STAGE_LABEL[stage] }}学段作品，其中必背
        {{ all.filter(p => p.curriculum?.recitation).length }} 篇；年级口径以课标为准（附录仅按学段分组）。
      </p>
      <div class="wj-stage-toolbar">
        <button type="button" class="wj-chip" :class="{ on: mode === 'dynasty' }" @click="mode = 'dynasty'">按朝代</button>
        <button type="button" class="wj-chip" :class="{ on: mode === 'form' }" @click="mode = 'form'">按体裁</button>
        <span class="wj-stage-total">共 {{ all.length }} 篇</span>
      </div>
      <section v-for="g in groups" :key="g.key" class="wj-grade">
        <h3>{{ g.key }}<span class="wj-count">{{ g.poems.length }} 篇</span></h3>
        <ul>
          <li v-for="p in g.poems" :key="p.id">
            <a :href="toRoute(p)">《{{ p.title }}》</a>
            <span class="wj-sub">{{ p.dynasty }} · {{ p.author }} · {{ p.tune ? p.tune + '（' + p.form + '）' : p.form }} · {{ p.genre }}</span>
            <span v-if="p.curriculum.recitation" class="wj-chip">必背</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wj-stage-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0 4px;
}
.wj-stage-total {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--wj-ink-3);
}
.wj-grade h3 {
  margin: 18px 0 6px;
  font-size: 16px;
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 6px;
}
.wj-count {
  margin-left: 8px;
  font-size: 12px;
  font-weight: normal;
  color: var(--vp-c-text-3);
}
.wj-sub {
  color: var(--vp-c-text-2);
  font-size: 13px;
  margin-left: 6px;
}
.wj-chip {
  margin-left: 8px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
ul {
  padding-left: 4px;
  list-style: none;
}
li {
  padding: 4px 0;
}
</style>
