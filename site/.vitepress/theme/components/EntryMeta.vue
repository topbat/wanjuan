<script setup lang="ts">
/**
 * 万卷 · 词条元数据面板（doc 底部，回源入口之上）
 * 从页面 frontmatter 读取结构化元数据，按词条类型渲染行 + pill；
 * 外观随主题令牌切换（ink 楷体界栏 / editorial spec 式 / youth 彩色 pill）。
 * 底部「加入复习」：把当前词条生成学习卡并入 FSRS 复习队列
 * （成语→释义卡 / 名句→溯源卡 / 作品→默写卡，见 composables/useReview.ts）。
 */
import { computed, onMounted, ref } from 'vue'
import { useData, useRoute } from 'vitepress'
import { addEntryToReview, hasCard, removeCard, type WjCardType } from '../composables/useReview'

const { frontmatter } = useData()
const route = useRoute()
const fm = computed<any>(() => frontmatter.value ?? {})
/** 当前路由 → 索引契约 srcPath（与 OpenInVSCode 的路由→源文件映射一致） */
const srcPath = computed<string>(() => {
  const p = decodeURIComponent(route.path).replace(/\/index\.html?$/, '/').replace(/\.html?$/, '')
  const m = p.match(/^\/(poems|idioms|quotes|authors|imagery)\/(.+)$/)
  return m ? `content/${m[1]}/${m[2]}.md` : ''
})

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

/* ---------- 加入复习（仅 成语/名句/作品 三类词条） ---------- */

const REVIEWABLE: Record<string, WjCardType> = {
  poem: 'recite',
  idiom: 'meaning',
  quote: 'origin',
}
const REVIEW_HINT: Record<string, string> = { poem: '默写卡', idiom: '释义卡', quote: '溯源卡' }

const reviewable = computed(() => (kind.value ? REVIEWABLE[kind.value] : null))
const cardId = computed(() => (reviewable.value && fm.value.id ? `${reviewable.value}:${fm.value.id}` : ''))

const inQueue = ref(false)
const busy = ref(false)
const reviewNote = ref('')

onMounted(() => {
  if (cardId.value) inQueue.value = hasCard(cardId.value)
})

async function toggleReview() {
  if (busy.value || !reviewable.value) return
  busy.value = true
  reviewNote.value = '' // TODO(debug) 临时调试，定位后删除
  console.warn('[wj-debug] kind=', kind.value, 'srcPath=', srcPath.value, 'fm.id=', fm.value.id)
  try {
    if (inQueue.value) {
      const r = removeCard(cardId.value)
      reviewNote.value = r.ok ? '已移出复习队列。' : r.message
      if (r.ok) inQueue.value = false
    } else {
      const r = await addEntryToReview({ kind: kind.value as 'poem' | 'idiom' | 'quote', srcPath: srcPath.value, fm: fm.value })
      if (r.added > 0) {
        inQueue.value = true
        reviewNote.value = `已生成${REVIEW_HINT[kind.value ?? ''] ?? '学习卡'}并加入今日复习队列。`
      } else if (r.skipped > 0) {
        inQueue.value = true
        reviewNote.value = '该词条已在复习队列中。'
      } else {
        reviewNote.value = r.result.ok ? '未能生成学习卡（缺少可用题面数据）。' : r.result.message
      }
    }
  } catch (e: any) {
    reviewNote.value = `加入复习失败：${e?.message ?? '未知错误'}`
  } finally {
    busy.value = false
    if (reviewNote.value) {
      window.setTimeout(() => {
        reviewNote.value = ''
      }, 5000)
    }
  }
}

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
    <div v-if="reviewable" class="wj-review-add">
      <button
        class="wj-review-btn"
        :class="{ added: inQueue }"
        :disabled="busy"
        @click="toggleReview"
      >
        {{ busy ? '处理中…' : inQueue ? '已加入复习 ✓' : '＋ 加入复习' }}
      </button>
      <span class="wj-review-hint">{{ REVIEW_HINT[kind!] }} · {{ inQueue ? '点击可移出队列' : '加入后进入间隔复习' }}</span>
      <div v-if="reviewNote" class="wj-review-note" role="status">{{ reviewNote }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 「加入复习」按钮行：全部走 --wj-* 令牌，随三主题圆角/强调色 */
.wj-review-add {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--wj-line);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.wj-review-btn {
  padding: 6px 16px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-accent);
  color: #fff;
  font-size: 13px;
  font-family: var(--wj-font-display);
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.16s;
}

.wj-review-btn:hover {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
}

.wj-review-btn.added {
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  border: 1px solid var(--wj-line);
}

.wj-review-btn.added:hover {
  border-color: var(--wj-accent);
}

.wj-review-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.wj-review-hint {
  font-size: 12px;
  color: var(--wj-ink-3);
  letter-spacing: 0.04em;
}

.wj-review-note {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--wj-ink-2);
}
</style>
