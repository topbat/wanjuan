<script setup lang="ts">
/**
 * 万卷 · 词条元数据面板（doc 底部，回源入口之上）
 * 从页面 frontmatter 读取结构化元数据，按词条类型渲染行 + pill；
 * 外观随主题令牌切换（ink 楷体界栏 / editorial spec 式 / youth 彩色 pill）。
 */
import { computed } from 'vue'
import { useData } from 'vitepress'

const { frontmatter } = useData()
const fm = computed<any>(() => frontmatter.value ?? {})

const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }

/** 词条类型：由 frontmatter 字段特征推断（与 content/ 目录类型一一对应） */
const kind = computed<'poem' | 'idiom' | 'quote' | 'author' | 'imagery' | null>(() => {
  const f = fm.value
  if (f.form && f.curriculum) return 'poem'
  if (f.word && f.pinyin) return 'idiom'
  if (f.text && f.theme) return 'quote'
  if (f.name && (f.courtesy !== undefined || f.birth !== undefined)) return 'author'
  if (f.senses) return 'imagery'
  return null
})

const KIND_TITLE = { poem: '题解', idiom: '成语档案', quote: '名句档案', author: '作者小传', imagery: '意象档案' }

const rows = computed<{ k: string; v: string }[]>(() => {
  const f = fm.value
  const out: { k: string; v: string }[] = []
  const c = f.curriculum
  if (kind.value === 'poem') {
    if (f.author) out.push({ k: '作者', v: f.author })
    if (f.dynasty) out.push({ k: '朝代', v: f.dynasty })
    if (f.form) out.push({ k: '体裁', v: f.tune ? `${f.tune} · ${f.form}` : f.form })
    if (f.genre) out.push({ k: '题材', v: f.genre })
    if (f.source?.anthology) out.push({ k: '出处', v: f.source.anthology })
    if (c) out.push({ k: '课标', v: `${STAGE_LABEL[c.stage] ?? c.stage}${c.grade}年级${c.recitation ? ' · 必背' : ''}` })
  } else if (kind.value === 'idiom') {
    out.push({ k: '拼音', v: f.pinyin ?? '' })
    if (f.semantic_field) out.push({ k: '语义场', v: f.semantic_field })
    if (f.origin) out.push({ k: '书证', v: String(f.origin).slice(0, 30) + (String(f.origin).length > 30 ? '…' : '') })
    if (c) out.push({ k: '课标', v: `${STAGE_LABEL[c.stage] ?? c.stage}${c.grade}年级` })
  } else if (kind.value === 'quote') {
    if (f.author) out.push({ k: '作者', v: f.author })
    if (f.dynasty) out.push({ k: '朝代', v: f.dynasty })
    if (f.work) out.push({ k: '源作品', v: f.work })
    if (c) out.push({ k: '课标', v: `${STAGE_LABEL[c.stage] ?? c.stage}${c.grade}年级${c.recitation ? ' · 必背' : ''}` })
  } else if (kind.value === 'author') {
    if (f.courtesy) out.push({ k: '字', v: f.courtesy })
    if (f.pseudonym) out.push({ k: '号', v: f.pseudonym })
    if (f.birth || f.death) out.push({ k: '生卒', v: `${f.birth ?? '?'} — ${f.death ?? '?'}` })
    if (f.dynasty) out.push({ k: '朝代', v: f.dynasty })
    if (f.school) out.push({ k: '流派', v: f.school })
  } else if (kind.value === 'imagery') {
    if (f.senses?.length) out.push({ k: '义项', v: f.senses.map((s: any) => s.sense).join(' / ') })
    if (f.representative?.length) out.push({ k: '例句', v: f.representative[0].line })
  }
  return out
})

const pills = computed<string[]>(() => {
  const f = fm.value
  if (kind.value === 'poem') return [...(f.imagery ?? []), ...(f.tags ?? [])]
  if (kind.value === 'quote') return [...(f.theme ?? []), ...(f.tags ?? [])]
  return [...(f.tags ?? [])]
})
</script>

<template>
  <div v-if="kind" class="wj-meta">
    <div class="wj-meta-title">{{ KIND_TITLE[kind] }}</div>
    <dl v-if="rows.length" class="wj-meta-rows">
      <div v-for="r in rows" :key="r.k" class="wj-row">
        <dt>{{ r.k }}</dt>
        <dd>{{ r.v }}</dd>
      </div>
    </dl>
    <div v-if="pills.length" class="wj-pills">
      <span v-for="(p, i) in pills" :key="p + i" class="wj-pill" :class="{ accent: kind === 'poem' && i < (fm.imagery?.length ?? 0) }">{{ p }}</span>
    </div>
  </div>
</template>
