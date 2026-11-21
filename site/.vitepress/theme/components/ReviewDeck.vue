<script setup lang="ts">
/**
 * 万卷 · 今日复习卡片流（FSRS 间隔重复）
 *
 * 流程：正面题面 → 显示答案 → 四档自评（重来/困难/良好/简单 → ts-fsrs Rating 1-4）。
 * 数据全部来自 localStorage（wj-review-state），卡片由词条页「加入复习」或每日一卷错题生成。
 * 学习步长（分钟级）到期的卡会随轮询自动出现在队列里。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CARD_TYPE_LABEL,
  RATING_LABEL,
  entryHref,
  previewIntervals,
  rateCard,
  removeCard,
  reviewStats,
  todayQueue,
  type QueueEntry,
  type WjRating,
} from '../composables/useReview'

const ready = ref(false)
const queue = ref<QueueEntry[]>([])
const stats = ref({ total: 0, dueCount: 0, doneToday: 0 })
const revealed = ref(false)
const selected = ref('')
const notice = ref('')
const intervals = ref<Record<WjRating, string> | null>(null)

let timer: number | undefined

function refresh() {
  const now = new Date()
  queue.value = todayQueue(now)
  stats.value = reviewStats(now)
  revealed.value = false
  selected.value = ''
  const first = queue.value[0]
  intervals.value = first ? previewIntervals(first.card.id, now) : null
}

onMounted(() => {
  refresh()
  ready.value = true
  timer = window.setInterval(refresh, 20000) // 分钟级学习步长到期后自动补入队列
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

const current = computed(() => queue.value[0] ?? null)
const progress = computed(() => {
  const { dueCount, doneToday } = stats.value
  const all = dueCount + doneToday
  return all === 0 ? 0 : Math.round((doneToday / all) * 100)
})
const isChoice = computed(() => current.value?.card.type === 'meaning' || current.value?.card.type === 'origin')

watch(current, (c) => {
  if (!c) return
  revealed.value = false
  selected.value = ''
  intervals.value = previewIntervals(c.card.id, new Date())
})

function showAnswer() {
  revealed.value = true
}

function pickOption(option: string) {
  if (revealed.value) return
  selected.value = option
  revealed.value = true // 点选即自检，随后手动四档自评
}

function rate(rating: WjRating) {
  const entry = current.value
  if (!entry) return
  const { result } = rateCard(entry.card.id, rating, new Date())
  if (!result.ok) {
    notice.value = result.message
    window.setTimeout(() => (notice.value = ''), 6000)
  }
  refresh()
}

async function dropCard() {
  const entry = current.value
  if (!entry) return
  const { result } = removeCard(entry.card.id)
  if (!result.ok) notice.value = result.message
  refresh()
}

const RATINGS: WjRating[] = [1, 2, 3, 4]
</script>

<template>
  <div class="wj-review">
    <!-- 顶部进度 -->
    <div class="wj-review-progress">
      <div class="wj-review-progress-text">
        <span>今日待复习 <b>{{ stats.dueCount }}</b></span>
        <span>已完成 <b>{{ stats.doneToday }}</b></span>
        <span>队列共 {{ stats.total }} 张</span>
      </div>
      <div class="wj-review-progress-bar">
        <div class="wj-review-progress-fill" :style="{ width: progress + '%' }" />
      </div>
    </div>

    <div v-if="notice" class="wj-review-notice" role="alert">{{ notice }}</div>

    <!-- 加载中（SSR 首帧） -->
    <div v-if="!ready" class="wj-review-card wj-review-empty">正在加载复习队列…</div>

    <!-- 空态：无到期卡 -->
    <div v-else-if="!current" class="wj-review-card wj-review-empty">
      <template v-if="stats.total === 0">
        <p class="wj-review-empty-title">复习队列还是空的</p>
        <p>去词条页（作品 / 成语 / 名句）点「＋ 加入复习」生成学习卡，<br>或先做一套<a href="../quiz/index.html">每日一卷</a>，错题会自动进入复习队列。</p>
      </template>
      <template v-else-if="stats.dueCount === 0 && stats.doneToday > 0">
        <p class="wj-review-empty-title">今日复习完成 ✓</p>
        <p>今天已复习 {{ stats.doneToday }} 张卡，先到这里。明天再来，或去<a href="../quiz/index.html">每日一卷</a>练一套。</p>
      </template>
      <template v-else>
        <p class="wj-review-empty-title">暂时没有到期卡片</p>
        <p>可以先做一套<a href="../quiz/index.html">每日一卷</a>，或到词条页把更多内容「加入复习」。</p>
      </template>
    </div>

    <!-- 卡片流 -->
    <div v-else class="wj-review-card">
      <div class="wj-review-card-head">
        <span class="wj-review-badge">{{ CARD_TYPE_LABEL[current.card.type] }}</span>
        <span class="wj-review-context">{{ current.card.context || current.card.entryTitle }}</span>
        <span class="wj-review-count">第 {{ current.fsrs.reps + 1 }} 次复习</span>
      </div>

      <!-- 正面题面 -->
      <div class="wj-review-face">
        <p v-if="current.card.type === 'recite'" class="wj-review-poem">
          {{ current.card.front }}，<span class="wj-review-blank">＿＿＿＿＿＿</span>。
        </p>
        <template v-else>
          <p class="wj-review-front">{{ current.card.front }}</p>
          <p v-if="current.card.subfront" class="wj-review-subfront">{{ current.card.subfront }}</p>
        </template>
        <p class="wj-review-prompt">
          {{ current.card.type === 'recite' ? '请默出下句，再显示答案自评' : isChoice ? '请先在心里作答，再点选项核对' : '回想答案后显示核对' }}
        </p>

        <!-- 四选一选项 -->
        <div v-if="isChoice" class="wj-review-options">
          <button
            v-for="opt in current.card.options"
            :key="opt"
            class="wj-review-option"
            :class="{
              chosen: selected === opt,
              correct: revealed && opt === current.card.back,
              wrong: revealed && selected === opt && opt !== current.card.back,
            }"
            @click="pickOption(opt)"
          >
            {{ opt }}
          </button>
        </div>
      </div>

      <!-- 背面答案 -->
      <div v-if="revealed" class="wj-review-answer">
        <template v-if="current.card.type === 'recite'">
          <p class="wj-review-poem">{{ current.card.front }}，{{ current.card.back }}。</p>
        </template>
        <template v-else>
          <p class="wj-review-answer-label">正确答案</p>
          <p class="wj-review-answer-text">{{ current.card.back }}</p>
        </template>
        <a class="wj-review-src" :href="entryHref(current.card)">回源：{{ current.card.entryTitle }}</a>
      </div>

      <!-- 操作区 -->
      <div class="wj-review-actions">
        <button v-if="!revealed" class="wj-review-reveal" @click="showAnswer">显示答案</button>
        <template v-else>
          <p class="wj-review-rate-hint">按回忆情况自评，决定下次复习时间：</p>
          <div class="wj-review-ratings">
            <button
              v-for="r in RATINGS"
              :key="r"
              class="wj-review-rate"
              :class="{ hard: r === 1 || r === 2, easy: r === 4 }"
              @click="rate(r)"
            >
              <span class="wj-review-rate-label">{{ RATING_LABEL[r] }}</span>
              <span v-if="intervals" class="wj-review-rate-interval">≈ {{ intervals[r] }}</span>
            </button>
          </div>
        </template>
        <button class="wj-review-drop" title="从复习队列移除这张卡" @click="dropCard">移除此卡</button>
      </div>
    </div>

    <p class="wj-review-foot">
      调度由 FSRS 算法（ts-fsrs，默认参数）在本地完成，进度保存在浏览器 localStorage（键 wj-review-state）。
    </p>
  </div>
</template>

<style scoped>
.wj-review {
  margin: 16px 0 32px;
}

/* ---- 进度条 ---- */
.wj-review-progress {
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  padding: 12px 18px;
  box-shadow: var(--wj-shadow);
}

.wj-review-progress-text {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  font-size: 13px;
  color: var(--wj-ink-2);
  margin-bottom: 8px;
}

.wj-review-progress-text b {
  color: var(--wj-accent);
  font-size: 15px;
  margin: 0 2px;
}

.wj-review-progress-bar {
  height: 6px;
  background: var(--wj-bg-soft);
  border-radius: var(--wj-radius-pill);
  overflow: hidden;
}

.wj-review-progress-fill {
  height: 100%;
  background: var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  transition: width 0.3s;
}

/* ---- 消息条 ---- */
.wj-review-notice {
  margin-top: 12px;
  padding: 10px 14px;
  border: 1px solid var(--wj-line);
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
  color: var(--wj-ink);
  font-size: 13px;
}

/* ---- 卡片 ---- */
.wj-review-card {
  margin-top: 16px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
  padding: 22px 26px 18px;
}

.wj-review-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--wj-line-soft);
}

.wj-review-badge {
  padding: 3px 12px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
  font-size: 12px;
  letter-spacing: 0.14em;
  font-family: var(--wj-font-display);
}

.wj-review-context {
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-review-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--wj-ink-3);
}

/* ---- 题面 ---- */
.wj-review-face {
  padding: 18px 0 8px;
}

.wj-review-poem {
  font-family: var(--wj-font-poem);
  font-size: 1.35em;
  letter-spacing: 0.14em;
  line-height: 2;
  color: var(--wj-ink);
  margin: 0;
}

.wj-review-blank {
  color: var(--wj-ink-3);
}

.wj-review-front {
  font-family: var(--wj-font-display);
  font-size: 1.3em;
  letter-spacing: 0.1em;
  color: var(--wj-ink);
  margin: 0 0 4px;
}

.wj-review-subfront {
  font-size: 13px;
  color: var(--wj-ink-3);
  margin: 0;
}

.wj-review-prompt {
  font-size: 12px;
  color: var(--wj-ink-3);
  margin: 10px 0 0;
}

/* ---- 选项 ---- */
.wj-review-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.wj-review-option {
  text-align: left;
  padding: 10px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
  color: var(--wj-ink);
  font-size: 14px;
  line-height: 1.6;
  cursor: pointer;
  transition: border-color 0.15s;
}

.wj-review-option:hover {
  border-color: var(--wj-ink-3);
}

.wj-review-option.chosen {
  border-color: var(--wj-accent);
}

.wj-review-option.correct {
  border-color: var(--wj-accent);
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  font-weight: 700;
}

.wj-review-option.wrong {
  border-color: var(--wj-ink);
  background: var(--wj-bg-soft);
  color: var(--wj-ink-2);
  text-decoration: line-through;
}

/* ---- 答案 ---- */
.wj-review-answer {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid var(--wj-line-soft);
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
}

.wj-review-answer-label {
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--wj-ink-3);
  margin: 0 0 4px;
}

.wj-review-answer-text {
  font-size: 15px;
  color: var(--wj-ink);
  margin: 0;
  font-weight: 600;
}

.wj-review-src {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--wj-accent);
}

/* ---- 操作区 ---- */
.wj-review-actions {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--wj-line-soft);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.wj-review-reveal {
  padding: 10px 34px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-accent);
  color: #fff;
  font-size: 15px;
  font-family: var(--wj-font-display);
  letter-spacing: 0.12em;
  cursor: pointer;
}

.wj-review-reveal:hover {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
}

.wj-review-rate-hint {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--wj-ink-3);
  margin: 0;
}

.wj-review-ratings {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.wj-review-rate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 86px;
  padding: 8px 16px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  color: var(--wj-ink);
  cursor: pointer;
  transition: border-color 0.15s;
}

.wj-review-rate:hover {
  border-color: var(--wj-accent);
}

.wj-review-rate.hard {
  color: var(--wj-ink-2);
}

.wj-review-rate.easy {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}

.wj-review-rate-label {
  font-size: 15px;
  font-family: var(--wj-font-display);
  letter-spacing: 0.1em;
}

.wj-review-rate-interval {
  font-size: 11px;
  color: var(--wj-ink-3);
}

.wj-review-drop {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--wj-ink-3);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline dotted;
}

.wj-review-drop:hover {
  color: var(--wj-ink);
}

/* ---- 空态 ---- */
.wj-review-empty {
  text-align: center;
  padding: 42px 20px;
  color: var(--wj-ink-2);
  font-size: 14px;
  line-height: 2;
}

.wj-review-empty-title {
  font-family: var(--wj-font-display);
  font-size: 1.15em;
  color: var(--wj-ink);
  letter-spacing: 0.1em;
  margin: 0 0 6px;
}

.wj-review-empty a {
  color: var(--wj-accent);
}

.wj-review-foot {
  margin-top: 14px;
  font-size: 12px;
  color: var(--wj-ink-3);
}

@media (max-width: 640px) {
  .wj-review-card {
    padding: 16px;
  }

  .wj-review-ratings {
    width: 100%;
  }

  .wj-review-rate {
    flex: 1;
    min-width: 0;
  }
}
</style>
