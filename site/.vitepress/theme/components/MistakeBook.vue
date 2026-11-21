<script setup lang="ts">
/**
 * 万卷 · 错题本
 *
 * 数据源：wj-quiz-history 中全部错题（按时间倒序）。
 * 每题展示题面 / 你的答案 / 正确答案 / 来源词条链接；支持「重做此题」（行内作答）
 * 与「已掌握」移除。默写题重做走 useReview.checkReciteAnswer（容全角半角标点差异）。
 */
import { onMounted, ref } from 'vue'
import {
  CARD_TYPE_LABEL,
  allMistakes,
  checkReciteAnswer,
  entryHref,
  removeMistake,
  type WjMistake,
} from '../composables/useReview'

const ready = ref(false)
const mistakes = ref<WjMistake[]>([])
const notice = ref('')

const redoQid = ref('')
const redoInput = ref('')
const redoSelected = ref('')
const redoResult = ref<null | boolean>(null)

function refresh() {
  mistakes.value = allMistakes()
}

onMounted(() => {
  refresh()
  ready.value = true
})

function isChoice(m: WjMistake): boolean {
  return m.type === 'meaning' || m.type === 'origin'
}

function startRedo(m: WjMistake) {
  redoQid.value = redoQid.value === m.qid ? '' : m.qid
  redoInput.value = ''
  redoSelected.value = ''
  redoResult.value = null
}

function checkRedo(m: WjMistake) {
  if (isChoice(m)) {
    if (!redoSelected.value) return
    redoResult.value = redoSelected.value === m.back
  } else {
    if (!redoInput.value.trim()) return
    redoResult.value = checkReciteAnswer(redoInput.value, m.back)
  }
}

function mastered(m: WjMistake) {
  const r = removeMistake(m.qid)
  if (!r.ok) {
    notice.value = r.message
    window.setTimeout(() => (notice.value = ''), 6000)
    return
  }
  if (redoQid.value === m.qid) {
    redoQid.value = ''
    redoResult.value = null
  }
  refresh()
}
</script>

<template>
  <div class="wj-mistakes">
    <div v-if="notice" class="wj-mistakes-notice" role="alert">{{ notice }}</div>

    <div v-if="!ready" class="wj-mistakes-empty">正在加载错题本…</div>

    <div v-else-if="mistakes.length === 0" class="wj-mistakes-empty">
      <p class="wj-mistakes-empty-title">错题本是空的 ✓</p>
      <p>做一套<a href="index.html">每日一卷</a>，答错的题会自动收录到这里。</p>
    </div>

    <div v-else>
      <p class="wj-mistakes-count">共 <b>{{ mistakes.length }}</b> 道错题（按时间倒序）</p>

      <div v-for="m in mistakes" :key="m.qid" class="wj-mistake-card">
        <div class="wj-mistake-head">
          <span class="wj-mistake-type">{{ CARD_TYPE_LABEL[m.type] }}</span>
          <span class="wj-mistake-date">{{ m.date }}</span>
        </div>

        <div class="wj-mistake-body">
          <p class="wj-mistake-front">{{ m.front }}</p>
          <p v-if="m.subfront || m.context" class="wj-mistake-sub">{{ [m.subfront, m.context].filter(Boolean).join(' · ') }}</p>

          <div class="wj-mistake-answers">
            <p class="wj-mistake-yours">你的答案：{{ m.userAnswer }}</p>
            <p class="wj-mistake-right">正确答案：{{ m.back }}</p>
          </div>

          <div class="wj-mistake-actions">
            <button class="wj-mistake-btn" @click="startRedo(m)">{{ redoQid === m.qid ? '收起重做' : '重做此题' }}</button>
            <button class="wj-mistake-btn accent" @click="mastered(m)">已掌握，移除</button>
            <a class="wj-mistake-src" :href="entryHref(m)">回源：{{ m.entryTitle }}</a>
          </div>

          <!-- 行内重做 -->
          <div v-if="redoQid === m.qid" class="wj-mistake-redo">
            <template v-if="isChoice(m)">
              <div class="wj-mistake-redo-options">
                <button
                  v-for="opt in m.options"
                  :key="opt"
                  class="wj-mistake-redo-opt"
                  :class="{ chosen: redoSelected === opt }"
                  @click="redoSelected = opt; redoResult = null"
                >
                  {{ opt }}
                </button>
              </div>
            </template>
            <template v-else>
              <input
                v-model="redoInput"
                class="wj-mistake-redo-input"
                placeholder="输入下句（容全角/半角标点差异）"
                @keyup.enter="checkRedo(m)"
                @input="redoResult = null"
              />
            </template>
            <button class="wj-mistake-btn" :disabled="(isChoice(m) ? !redoSelected : !redoInput.trim())" @click="checkRedo(m)">核对</button>
            <p v-if="redoResult === true" class="wj-mistake-redo-ok">✓ 回答正确！可以点「已掌握，移除」了。</p>
            <p v-else-if="redoResult === false" class="wj-mistake-redo-bad">✗ 还差一点，正确答案是「{{ m.back }}」，再记一记。</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wj-mistakes {
  margin: 16px 0 32px;
}

.wj-mistakes-notice {
  padding: 10px 14px;
  border: 1px solid var(--wj-line);
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
  color: var(--wj-ink);
  font-size: 13px;
  margin-bottom: 12px;
}

.wj-mistakes-count {
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-mistakes-count b {
  color: var(--wj-accent);
  font-size: 16px;
}

.wj-mistake-card {
  margin-top: 14px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
  padding: 16px 20px;
}

.wj-mistake-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--wj-line-soft);
}

.wj-mistake-type {
  padding: 2px 12px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
  font-size: 12px;
  letter-spacing: 0.14em;
  font-family: var(--wj-font-display);
}

.wj-mistake-date {
  margin-left: auto;
  font-family: var(--wj-font-mono);
  font-size: 12px;
  color: var(--wj-ink-3);
}

.wj-mistake-front {
  font-family: var(--wj-font-poem);
  font-size: 1.2em;
  letter-spacing: 0.1em;
  color: var(--wj-ink);
  margin: 12px 0 2px;
}

.wj-mistake-sub {
  font-size: 12px;
  color: var(--wj-ink-3);
  margin: 0;
}

.wj-mistake-answers {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 6px 18px;
  font-size: 14px;
}

.wj-mistake-yours {
  margin: 0;
  color: var(--wj-ink-2);
}

.wj-mistake-right {
  margin: 0;
  color: var(--wj-accent);
  font-weight: 700;
}

.wj-mistake-actions {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.wj-mistake-btn {
  padding: 5px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-size: 13px;
  font-family: var(--wj-font-display);
  cursor: pointer;
}

.wj-mistake-btn:hover {
  color: var(--wj-ink);
  border-color: var(--wj-ink-3);
}

.wj-mistake-btn.accent {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}

.wj-mistake-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wj-mistake-src {
  font-size: 12px;
  color: var(--wj-accent);
}

.wj-mistake-redo {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px dashed var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
}

.wj-mistake-redo-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.wj-mistake-redo-opt {
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  color: var(--wj-ink);
  font-size: 13px;
  cursor: pointer;
}

.wj-mistake-redo-opt.chosen {
  border-color: var(--wj-accent);
  box-shadow: var(--wj-shadow-hover);
}

.wj-mistake-redo-input {
  width: min(420px, 100%);
  margin-bottom: 10px;
  padding: 8px 12px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  color: var(--wj-ink);
  font-size: 14px;
  font-family: var(--wj-font-poem);
}

.wj-mistake-redo-input:focus {
  outline: none;
  border-color: var(--wj-accent);
}

.wj-mistake-redo-ok {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--wj-accent);
  font-weight: 700;
}

.wj-mistake-redo-bad {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-mistakes-empty {
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
  text-align: center;
  padding: 42px 20px;
  color: var(--wj-ink-2);
  line-height: 2;
}

.wj-mistakes-empty-title {
  font-family: var(--wj-font-display);
  font-size: 1.15em;
  color: var(--wj-ink);
  margin: 0 0 6px;
}

.wj-mistakes-empty a {
  color: var(--wj-accent);
}
</style>
