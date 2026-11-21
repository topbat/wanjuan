<script setup lang="ts">
/**
 * 万卷 · 每日一卷（固定 8 题：默写填空 3 / 释义四选一 3 / 出处四选一 2）
 *
 * 种子 = 「日期 # 换卷序号」→ 同一天同序号必得同一卷；「换一卷」递增序号。
 * 交卷后逐题反馈对错与正确答案；成绩与错题写入 localStorage（wj-quiz-history），
 * 错题同时自动生成复习卡并入 FSRS 队列（useReview.submitQuiz）。
 */
import { computed, onMounted, ref } from 'vue'
import {
  CARD_TYPE_LABEL,
  buildDailyQuiz,
  entryHref,
  gradeQuestion,
  localDateKey,
  readQuizHistory,
  setVariant,
  submitQuiz,
  todayVariant,
  type DailyQuizPaper,
} from '../composables/useReview'

const ready = ref(false)
const loading = ref(false)
const date = ref('')
const variant = ref(0)
const paper = ref<DailyQuizPaper | null>(null)
const answers = ref<string[]>([])
const submitted = ref(false)
const results = ref<boolean[]>([])
const score = ref(0)
const notice = ref('')
const doneBefore = ref<{ score: number; total: number } | null>(null)

async function loadPaper(d: string, v: number, keepAnswers = false) {
  loading.value = true
  try {
    paper.value = await buildDailyQuiz(d, v)
    if (!keepAnswers) answers.value = paper.value.questions.map(() => '')
    submitted.value = false
    results.value = []
    // 今天这一卷是否已有成绩（重做会覆盖）
    const rec = readQuizHistory().records.find((r) => r.date === d && r.variant === v)
    doneBefore.value = rec ? { score: rec.score, total: rec.total } : null
  } catch (e: any) {
    notice.value = `组卷失败：${e?.message ?? '未知错误'}`
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  date.value = localDateKey()
  variant.value = todayVariant(date.value)
  await loadPaper(date.value, variant.value)
  ready.value = true
})

const answeredCount = computed(() => answers.value.filter((a) => a.trim() !== '').length)
const unanswered = computed(() => (paper.value?.questions.length ?? 0) - answeredCount.value)

function choose(i: number, option: string) {
  if (submitted.value) return
  answers.value[i] = answers.value[i] === option ? '' : option
}

function isChosen(i: number, opt: string): boolean {
  return answers.value[i] === opt
}

function submit() {
  const p = paper.value
  if (!p || submitted.value) return
  const r = submitQuiz(p, answers.value.slice())
  score.value = r.score
  results.value = p.questions.map((q, i) => gradeQuestion(q, answers.value[i] ?? ''))
  submitted.value = true
  if (!r.storeResult.ok) notice.value = r.storeResult.message
  else if (!r.enqueueResult.ok) notice.value = `成绩已保存，但错题入队失败：${r.enqueueResult.message}`
  else notice.value = ''
  if (r.mistakes.length > 0 && !notice.value) notice.value = ''
}

async function switchPaper() {
  date.value = localDateKey()
  const next = variant.value + 1
  const sr = setVariant(date.value, next)
  if (!sr.ok) {
    notice.value = sr.message
    return
  }
  variant.value = next
  await loadPaper(date.value, next)
}

async function retrySame() {
  await loadPaper(date.value, variant.value)
  submitted.value = false
}

function focusBlank(i: number, ev: Event) {
  if (submitted.value) {
    ev.preventDefault()
    return
  }
  void i
}
</script>

<template>
  <div class="wj-quiz">
    <!-- 卷头 -->
    <div class="wj-quiz-head">
      <div class="wj-quiz-head-title">
        <span class="wj-quiz-date">{{ date }}</span>
        <span class="wj-quiz-variant">第 {{ variant + 1 }} 卷</span>
        <span v-if="doneBefore && !submitted" class="wj-quiz-done">今日此卷已答过：{{ doneBefore.score }}/{{ doneBefore.total }}，可再练或换卷</span>
      </div>
      <div class="wj-quiz-head-actions">
        <button class="wj-quiz-btn" :disabled="loading" @click="retrySame">再练一次</button>
        <button class="wj-quiz-btn accent" :disabled="loading" @click="switchPaper">换一卷 ⟳</button>
      </div>
    </div>

    <div v-if="notice" class="wj-quiz-notice" role="alert">{{ notice }}</div>
    <div v-if="!ready || loading" class="wj-quiz-card wj-quiz-loading">正在组卷…</div>

    <!-- 成绩横幅 -->
    <div v-if="submitted && paper" class="wj-quiz-score" :class="{ full: score === paper.questions.length }">
      <span class="wj-quiz-score-num">{{ score }}<i>/{{ paper.questions.length }}</i></span>
      <span class="wj-quiz-score-text">
        {{ score === paper.questions.length ? '全对，可换一卷继续挑战' : `答对 ${score} 题、答错 ${paper.questions.length - score} 题` }}
      </span>
      <span v-if="paper.questions.length - score > 0" class="wj-quiz-score-note">错题已生成复习卡进入<a href="../review/index.html">复习队列</a>，并记入<a href="mistakes.html">错题本</a></span>
      <span v-else class="wj-quiz-score-note">继续保持，明天再来一卷</span>
    </div>

    <!-- 题目 -->
    <div v-if="ready && !loading && paper">
      <div v-for="(q, i) in paper.questions" :key="q.card.id" class="wj-quiz-card" :class="{ wrong: submitted && !results[i] }">
        <div class="wj-quiz-q-head">
          <span class="wj-quiz-q-no">{{ i + 1 }}</span>
          <span class="wj-quiz-q-type">{{ q.mode === 'input' ? '默写填空' : q.card.type === 'meaning' ? '释义四选一' : '出处四选一' }}</span>
          <span class="wj-quiz-q-verdict" v-if="submitted" :class="{ ok: results[i] }">{{ results[i] ? '✓ 对' : '✗ 错' }}</span>
        </div>

        <div class="wj-quiz-q-body">
          <!-- 默写填空 -->
          <template v-if="q.mode === 'input'">
            <p class="wj-quiz-line">{{ q.card.front }}，<span class="wj-quiz-blank">＿＿＿＿＿＿</span>。</p>
            <p class="wj-quiz-hint">补出下句（{{ q.card.context || q.card.entryTitle }}）</p>
            <input
              v-model="answers[i]"
              class="wj-quiz-input"
              :class="{ ok: submitted && results[i], bad: submitted && !results[i] }"
              :disabled="submitted"
              placeholder="输入下句…"
              @focus="focusBlank(i, $event)"
            />
            <p v-if="submitted" class="wj-quiz-answer">
              正确答案：<b>{{ q.card.back }}</b>
              <a class="wj-quiz-src" :href="entryHref(q.card)">回源：{{ q.card.entryTitle }}</a>
            </p>
          </template>

          <!-- 四选一 -->
          <template v-else>
            <p class="wj-quiz-line small">{{ q.card.front }}</p>
            <p v-if="q.card.subfront" class="wj-quiz-hint">{{ q.card.subfront }}</p>
            <div class="wj-quiz-options">
              <button
                v-for="opt in q.card.options"
                :key="opt"
                class="wj-quiz-option"
                :class="{
                  chosen: !submitted && isChosen(i, opt),
                  correct: submitted && opt === q.card.back,
                  wrongpick: submitted && isChosen(i, opt) && opt !== q.card.back,
                }"
                :disabled="submitted"
                @click="choose(i, opt)"
              >
                {{ opt }}
              </button>
            </div>
            <p v-if="submitted && !results[i]" class="wj-quiz-answer">
              正确答案：<b>{{ q.card.back }}</b>
              <a class="wj-quiz-src" :href="entryHref(q.card)">回源：{{ q.card.entryTitle }}</a>
            </p>
          </template>
        </div>
      </div>

      <!-- 交卷 -->
      <div v-if="!submitted" class="wj-quiz-submit-row">
        <span class="wj-quiz-progress">已答 {{ answeredCount }}/{{ paper.questions.length }}<template v-if="unanswered > 0">（还有 {{ unanswered }} 题未答）</template></span>
        <button class="wj-quiz-submit" @click="submit">交卷</button>
      </div>
      <div v-else class="wj-quiz-submit-row">
        <button class="wj-quiz-btn" @click="retrySame">再练一次同卷</button>
        <button class="wj-quiz-btn accent" @click="switchPaper">换一卷 ⟳</button>
      </div>
    </div>

    <p class="wj-quiz-foot">题目从全库索引按「日期＋卷号」种子抽取，同一天同一卷内容一致；成绩与错题仅保存在浏览器本地（键 wj-quiz-history）。</p>
  </div>
</template>

<style scoped>
.wj-quiz {
  margin: 16px 0 32px;
}

/* ---- 卷头 ---- */
.wj-quiz-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
  padding: 12px 18px;
}

.wj-quiz-head-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.wj-quiz-date {
  font-family: var(--wj-font-mono);
  font-size: 14px;
  color: var(--wj-ink-2);
}

.wj-quiz-variant {
  font-family: var(--wj-font-display);
  font-size: 15px;
  color: var(--wj-ink);
  letter-spacing: 0.1em;
}

.wj-quiz-done {
  font-size: 12px;
  color: var(--wj-ink-3);
}

.wj-quiz-head-actions {
  display: flex;
  gap: 8px;
}

.wj-quiz-btn {
  padding: 6px 16px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-size: 13px;
  font-family: var(--wj-font-display);
  cursor: pointer;
}

.wj-quiz-btn:hover {
  color: var(--wj-ink);
  border-color: var(--wj-ink-3);
}

.wj-quiz-btn.accent {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}

.wj-quiz-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

/* ---- 消息 ---- */
.wj-quiz-notice {
  margin-top: 12px;
  padding: 10px 14px;
  border: 1px solid var(--wj-line);
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
  color: var(--wj-ink);
  font-size: 13px;
}

.wj-quiz-loading {
  margin-top: 16px;
  text-align: center;
  padding: 40px;
  color: var(--wj-ink-2);
}

/* ---- 成绩横幅 ---- */
.wj-quiz-score {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  padding: 16px 22px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius);
  background: var(--wj-accent-tint);
}

.wj-quiz-score.full {
  background: var(--wj-card);
}

.wj-quiz-score-num {
  font-family: var(--wj-font-display);
  font-size: 2em;
  font-weight: 800;
  color: var(--wj-accent);
  line-height: 1;
}

.wj-quiz-score-num i {
  font-style: normal;
  font-size: 0.55em;
  color: var(--wj-ink-3);
}

.wj-quiz-score-text {
  font-size: 15px;
  color: var(--wj-ink);
}

.wj-quiz-score-note {
  flex-basis: 100%;
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-quiz-score-note a {
  color: var(--wj-accent);
}

/* ---- 题卡 ---- */
.wj-quiz-card {
  margin-top: 14px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
  padding: 16px 20px;
}

.wj-quiz-card.wrong {
  border-color: var(--wj-ink);
}

.wj-quiz-q-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.wj-quiz-q-no {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--wj-ink);
  border-radius: var(--wj-radius-pill);
  font-size: 12px;
  font-family: var(--wj-font-mono);
  color: var(--wj-ink);
}

.wj-quiz-q-type {
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--wj-accent);
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  padding: 2px 10px;
}

.wj-quiz-q-verdict {
  margin-left: auto;
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-quiz-q-verdict.ok {
  color: var(--wj-accent);
  font-weight: 700;
}

.wj-quiz-line {
  font-family: var(--wj-font-poem);
  font-size: 1.25em;
  letter-spacing: 0.12em;
  line-height: 1.9;
  color: var(--wj-ink);
  margin: 0;
}

.wj-quiz-line.small {
  font-family: var(--wj-font-display);
  font-size: 1.1em;
}

.wj-quiz-blank {
  color: var(--wj-ink-3);
}

.wj-quiz-hint {
  font-size: 12px;
  color: var(--wj-ink-3);
  margin: 6px 0 10px;
}

.wj-quiz-input {
  width: min(420px, 100%);
  padding: 9px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
  color: var(--wj-ink);
  font-size: 15px;
  font-family: var(--wj-font-poem);
  letter-spacing: 0.08em;
}

.wj-quiz-input:focus {
  outline: none;
  border-color: var(--wj-accent);
}

.wj-quiz-input:disabled {
  opacity: 0.85;
}

.wj-quiz-input.ok {
  border-color: var(--wj-accent);
  background: var(--wj-accent-tint);
}

.wj-quiz-input.bad {
  border-color: var(--wj-ink);
  background: var(--wj-bg-soft);
}

.wj-quiz-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  margin-top: 8px;
}

.wj-quiz-option {
  text-align: left;
  padding: 10px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
  color: var(--wj-ink);
  font-size: 14px;
  line-height: 1.6;
  cursor: pointer;
}

.wj-quiz-option:hover:not(:disabled) {
  border-color: var(--wj-ink-3);
}

.wj-quiz-option.chosen {
  border-color: var(--wj-accent);
  box-shadow: var(--wj-shadow-hover);
}

.wj-quiz-option.correct {
  border-color: var(--wj-accent);
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  font-weight: 700;
}

.wj-quiz-option.wrongpick {
  border-color: var(--wj-ink);
  color: var(--wj-ink-2);
  text-decoration: line-through;
}

.wj-quiz-option:disabled {
  cursor: default;
}

.wj-quiz-answer {
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--wj-ink);
}

.wj-quiz-answer b {
  color: var(--wj-accent);
}

.wj-quiz-src {
  margin-left: 12px;
  font-size: 12px;
  color: var(--wj-accent);
}

/* ---- 交卷行 ---- */
.wj-quiz-submit-row {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.wj-quiz-progress {
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-quiz-submit {
  margin-left: auto;
  padding: 10px 42px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-accent);
  color: #fff;
  font-size: 15px;
  font-family: var(--wj-font-display);
  letter-spacing: 0.2em;
  cursor: pointer;
}

.wj-quiz-submit:hover {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
}

.wj-quiz-foot {
  margin-top: 14px;
  font-size: 12px;
  color: var(--wj-ink-3);
}

@media (max-width: 640px) {
  .wj-quiz-card {
    padding: 12px 14px;
  }

  .wj-quiz-submit {
    width: 100%;
    margin-left: 0;
  }
}
</style>
