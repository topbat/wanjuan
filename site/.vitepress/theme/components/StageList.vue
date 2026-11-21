<script setup lang="ts">
// 万卷 · 学段清单（按课标 stage 过滤 poems.json，按年级分组）
import { onMounted, ref } from 'vue'

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
const groups = ref<{ grade: string; poems: Poem[] }[]>([])

onMounted(async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/poems.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const poems = (data.items ?? []).filter((p: Poem) => p.curriculum?.stage === props.stage)
    const byGrade = new Map<string, Poem[]>()
    for (const p of poems) {
      const key = `${STAGE_LABEL[p.curriculum.stage]}${p.curriculum.grade}年级`
      if (!byGrade.has(key)) byGrade.set(key, [])
      byGrade.get(key)!.push(p)
    }
    groups.value = [...byGrade.entries()]
      .sort((a, b) => Number(a[0].replace(/\D/g, '')) - Number(b[0].replace(/\D/g, '')))
      .map(([grade, list]) => ({ grade, poems: list }))
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
        当前收录 {{ groups.reduce((n, g) => n + g.poems.length, 0) }} 篇{{ STAGE_LABEL[stage] }}学段作品；
        「必背」标记对齐课标推荐背诵篇目，完整 75+61+72 篇映射见 public/curriculum/。
      </p>
      <section v-for="g in groups" :key="g.grade" class="wj-grade">
        <h3>{{ g.grade }}<span class="wj-count">{{ g.poems.length }} 篇</span></h3>
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
