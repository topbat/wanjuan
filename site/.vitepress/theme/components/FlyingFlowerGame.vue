<script setup lang="ts">
/**
 * 万卷 · 飞花令（人机对句）
 *
 * 数据源：/indexes/lines.json（构建索引产物，2257 条诗句）
 * 规则（教学向）：
 *   - 选令字后玩家先答，答对 +10；AI 从剩余诗句中随机接一句（优先不同朝代/篇目）。
 *   - 判定只比较去掉标点与空白后的内容；玩家可只输入半句，但不少于 5 字。
 *   - 同一句（按去标点后的文本去重）不能用第二次。
 *   - 跳过/超时：AI +5，并由 AI 接着吟一句；10 轮或一方无句可接时结束。
 *
 * 交互：回车提交、30 秒倒计时可关闭、换令字重开、aria-live 播报。
 */
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
} from 'vue'

type RawLine = {
  line: string
  poemId: string
  title: string
  author: string
  dynasty: string
  srcPath: string
}

type LineEntry = RawLine & {
  key: string
  norm: string
  route: string
  titleText: string
}

type LineFlow = {
  kind: 'line'
  id: number
  who: 'player' | 'ai'
  entry: LineEntry
  raw?: string
  round: number
}

type NoteFlow = {
  kind: 'note'
  id: number
  text: string
}

type FlowItem = LineFlow | NoteFlow

const BASE = import.meta.env.BASE_URL
const TOKENS = ['春', '月', '花', '风', '雨', '山', '水', '酒', '夜', '云']
const MAX_ROUNDS = 10
const TURN_SECONDS = 30
const MIN_LEN = 5

const lines = ref<LineEntry[]>([])
const loading = ref(true)
const loadError = ref('')

const phase = ref<'setup' | 'playing' | 'ended'>('setup')
const selected = ref('')
const usedKeys = ref<Set<string>>(new Set())
const flow = ref<FlowItem[]>([])
const round = ref(1)
const turn = ref<'player' | 'ai' | 'ended'>('player')
const input = ref('')
const feedback = ref('')
const feedbackKind = ref<'info' | 'ok' | 'error'>('info')
const announcement = ref('')
const playerScore = ref(0)
const aiScore = ref(0)
const playerHits = ref(0)
const skipCount = ref(0)
const timerOn = ref(true)
const seconds = ref(TURN_SECONDS)
const aiThinking = ref(false)
const endReason = ref<'' | 'rounds' | 'ai-empty' | 'player-empty'>('')
const lastEntry = ref<LineEntry | null>(null)
const lastDynasty = ref('')
const lastPoemId = ref('')

const flowEl = ref<HTMLElement | null>(null)
let logSeq = 0
let timerId = 0
let aiTimerId = 0

/** 统一去标点/空白（NFKC 归一全角字符），用于内容比较与去重 */
function normalizeText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\p{P}\p{S}\s]/gu, '')
    .toLowerCase()
}

function cleanTitle(title: string): string {
  const t = String(title ?? '').trim()
  if (!t) return ''
  return /^[《〈]/.test(t) ? t : `《${t}》`
}

function toRoute(srcPath: string): string {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

const tokenCounts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const token of TOKENS) {
    const keys = new Set<string>()
    for (const item of lines.value) {
      if (item.norm.includes(token)) keys.add(item.key)
    }
    out[token] = keys.size
  }
  return out
})

const remainingCount = computed(() => {
  if (!selected.value) return 0
  const keys = new Set<string>()
  for (const item of lines.value) {
    if (item.norm.includes(selected.value) && !usedKeys.value.has(item.key)) {
      keys.add(item.key)
    }
  }
  return keys.size
})

const appearedLines = computed(() =>
  flow.value.filter((item): item is LineFlow => item.kind === 'line'),
)

const timerPercent = computed(() =>
  Math.max(0, Math.min(100, (seconds.value / TURN_SECONDS) * 100)),
)

const outcomeTitle = computed(() => {
  if (endReason.value === 'ai-empty') return 'AI 接不上，你赢了'
  if (endReason.value === 'player-empty') return '诗囊已空，本局结束'
  if (endReason.value === 'rounds') return '十轮战罢'
  return '本局结束'
})

const endText = computed(() => {
  if (endReason.value === 'ai-empty') return 'AI 在索引中已找不到未用过的含令字诗句。'
  if (endReason.value === 'player-empty')
    return '剩余诗句都短于 5 字或已用尽，暂时没有可供你作答的句子。'
  if (endReason.value === 'rounds') return '已达 10 轮上限，可以换一个令字再战。'
  return ''
})

const inputDisabled = computed(
  () => phase.value !== 'playing' || turn.value !== 'player' || aiThinking.value,
)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${BASE}indexes/lines.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const items: RawLine[] = Array.isArray(data) ? data : (data.items ?? [])
    lines.value = items
      .filter((it) => String(it.line ?? '').trim())
      .map((it) => {
        const norm = normalizeText(it.line)
        return {
          line: String(it.line).trim(),
          poemId: String(it.poemId ?? ''),
          title: String(it.title ?? ''),
          author: String(it.author ?? ''),
          dynasty: String(it.dynasty ?? ''),
          srcPath: String(it.srcPath ?? ''),
          key: norm,
          norm,
          route: toRoute(String(it.srcPath ?? '')),
          titleText: cleanTitle(it.title),
        }
      })
  } catch (err: any) {
    loadError.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

function scrollFlow() {
  void nextTick(() => {
    const el = flowEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function pushFlow(item: FlowItem) {
  flow.value.push(item)
  scrollFlow()
}

function pushNote(text: string) {
  logSeq += 1
  pushFlow({ kind: 'note', id: logSeq, text })
}

function addLineFlow(entry: LineEntry, who: 'player' | 'ai', raw?: string) {
  logSeq += 1
  pushFlow({
    kind: 'line',
    id: logSeq,
    who,
    entry,
    raw,
    round: round.value,
  })
}

function markUsed(entry: LineEntry) {
  const next = new Set(usedKeys.value)
  next.add(entry.key)
  usedKeys.value = next
}

function stopTimer() {
  if (timerId) {
    window.clearInterval(timerId)
    timerId = 0
  }
}

function stopAiTimer() {
  if (aiTimerId) {
    window.clearTimeout(aiTimerId)
    aiTimerId = 0
  }
}

function tickTimer() {
  if (phase.value !== 'playing' || turn.value !== 'player') {
    stopTimer()
    return
  }
  seconds.value -= 1
  if (seconds.value <= 0) {
    seconds.value = 0
    stopTimer()
    skipTurn('timeout')
  }
}

function beginTicking() {
  stopTimer()
  if (!timerOn.value || phase.value !== 'playing' || turn.value !== 'player') return
  if (seconds.value <= 0) return
  timerId = window.setInterval(tickTimer, 1000)
}

function resetTimer() {
  seconds.value = TURN_SECONDS
  beginTicking()
}

function onTimerToggle() {
  stopTimer()
  if (!timerOn.value) {
    seconds.value = TURN_SECONDS
    return
  }
  if (phase.value === 'playing' && turn.value === 'player') resetTimer()
}

function setFeedback(text: string, kind: 'info' | 'ok' | 'error') {
  feedback.value = text
  feedbackKind.value = kind
}

/** 选出 AI 可用的诗句：优先不同朝代，再优先不同篇目 */
function pickAiEntry(): LineEntry | null {
  const remaining = lines.value.filter(
    (item) => item.norm.includes(selected.value) && !usedKeys.value.has(item.key),
  )
  if (!remaining.length) return null

  let pool = remaining
  if (lastDynasty.value) {
    const otherDynasty = remaining.filter((item) => item.dynasty !== lastDynasty.value)
    if (otherDynasty.length) pool = otherDynasty
  }
  if (lastPoemId.value) {
    const otherPoem = pool.filter((item) => item.poemId !== lastPoemId.value)
    if (otherPoem.length) pool = otherPoem
  }
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

function hasAiEntry(): boolean {
  return lines.value.some(
    (item) => item.norm.includes(selected.value) && !usedKeys.value.has(item.key),
  )
}

/** 玩家能否作答：需要有至少 5 字（去标点）的未用诗句 */
function hasPlayerEntry(): boolean {
  return lines.value.some(
    (item) =>
      item.norm.includes(selected.value) &&
      !usedKeys.value.has(item.key) &&
      Array.from(item.norm).length >= MIN_LEN,
  )
}

function scheduleAi() {
  turn.value = 'ai'
  aiThinking.value = true
  stopAiTimer()
  aiTimerId = window.setTimeout(runAiTurn, 720)
}

function runAiTurn() {
  aiTimerId = 0
  if (phase.value !== 'playing') return
  const picked = pickAiEntry()
  if (!picked) {
    aiThinking.value = false
    finish('ai-empty')
    return
  }

  markUsed(picked)
  addLineFlow(picked, 'ai')
  lastEntry.value = picked
  lastDynasty.value = picked.dynasty
  lastPoemId.value = picked.poemId
  aiThinking.value = false

  if (round.value >= MAX_ROUNDS) {
    finish('rounds')
    return
  }
  if (!hasPlayerEntry()) {
    finish('player-empty')
    return
  }

  round.value += 1
  turn.value = 'player'
  setFeedback(`AI 接「${picked.line}」。轮到你，令字仍是「${selected.value}」。`, 'info')
  announcement.value = `AI 接「${picked.line}」，作者${picked.author}。第 ${round.value} 轮，轮到你。`
  resetTimer()
  scrollFlow()
}

function finish(reason: 'rounds' | 'ai-empty' | 'player-empty') {
  stopTimer()
  stopAiTimer()
  aiThinking.value = false
  phase.value = 'ended'
  turn.value = 'ended'
  endReason.value = reason
  seconds.value = 0
  setFeedback(outcomeTitle.value, reason === 'ai-empty' ? 'ok' : 'info')
  announcement.value = `本局结束。${outcomeTitle.value}。你 ${playerScore.value} 分，AI ${aiScore.value} 分，共答对 ${playerHits.value} 句。`
  scrollFlow()
}

function acceptPlayer(entry: LineEntry, raw: string) {
  stopTimer()
  markUsed(entry)
  addLineFlow(entry, 'player', raw)
  playerHits.value += 1
  playerScore.value += 10
  lastEntry.value = entry
  lastDynasty.value = entry.dynasty
  lastPoemId.value = entry.poemId

  const rawNorm = normalizeText(raw)
  const half = rawNorm !== entry.norm
  setFeedback(
    `接上了！+10 分${half ? `（命中诗句「${entry.line}」）` : ''}。`,
    'ok',
  )
  announcement.value = `你答对「${entry.line}」，加 10 分。当前你 ${playerScore.value} 分，AI ${aiScore.value} 分。`
  input.value = ''

  if (!hasAiEntry()) {
    finish('ai-empty')
    return
  }
  scheduleAi()
}

function failAnswer(message: string) {
  setFeedback(message, 'error')
  announcement.value = `作答未通过：${message}`
}

function submitAnswer() {
  if (inputDisabled.value) return
  const raw = input.value.trim()
  const ans = normalizeText(raw)

  if (!ans) {
    failAnswer('请先输入一句含令字的诗。')
    return
  }
  if (Array.from(ans).length < MIN_LEN) {
    failAnswer(`至少输入 ${MIN_LEN} 个字（标点不计）。`)
    return
  }
  if (!ans.includes(selected.value)) {
    failAnswer(`这句里没有令字「${selected.value}」，换一句吧。`)
    return
  }

  const matches = lines.value.filter((item) => item.norm.includes(ans))
  if (!matches.length) {
    failAnswer('索引里没有找到这句诗，请换一句（可只输入半句）。')
    return
  }

  const unused = matches.filter((item) => !usedKeys.value.has(item.key))
  if (!unused.length) {
    failAnswer(`「${matches[0].line}」本局已经用过了，换一句。`)
    return
  }

  const exact = unused.find((item) => item.norm === ans)
  const chosen =
    exact ??
    [...unused].sort((a, b) => Array.from(a.norm).length - Array.from(b.norm).length)[0]
  acceptPlayer(chosen, raw)
}

function skipTurn(reason: 'skip' | 'timeout') {
  if (phase.value !== 'playing' || turn.value !== 'player' || aiThinking.value) return
  stopTimer()
  skipCount.value += 1
  aiScore.value += 5
  input.value = ''

  const note =
    reason === 'timeout'
      ? '倒计时结束，本轮跳过：AI +5 分，并由 AI 接一句。'
      : '你选择了跳过：AI +5 分，并由 AI 接一句。'
  pushNote(note)
  setFeedback(note, 'info')
  announcement.value = `${note} 当前你 ${playerScore.value} 分，AI ${aiScore.value} 分。`

  if (!hasAiEntry()) {
    finish('ai-empty')
    return
  }
  scheduleAi()
}

function startGame(token: string) {
  if (!tokenCounts.value[token]) return
  stopTimer()
  stopAiTimer()
  aiThinking.value = false
  selected.value = token
  phase.value = 'playing'
  usedKeys.value = new Set()
  flow.value = []
  round.value = 1
  turn.value = 'player'
  input.value = ''
  playerScore.value = 0
  aiScore.value = 0
  playerHits.value = 0
  skipCount.value = 0
  endReason.value = ''
  lastEntry.value = null
  lastDynasty.value = ''
  lastPoemId.value = ''
  setFeedback(`令字「${token}」已定，请你先吟一句。`, 'info')
  announcement.value = `飞花令开始，令字「${token}」。请你先输入一句含「${token}」的诗，至少 5 个字。`
  resetTimer()
}

function replay() {
  if (selected.value) startGame(selected.value)
}

function changeToken() {
  stopTimer()
  stopAiTimer()
  aiThinking.value = false
  phase.value = 'setup'
  selected.value = ''
  usedKeys.value = new Set()
  flow.value = []
  turn.value = 'player'
  input.value = ''
  endReason.value = ''
  setFeedback('', 'info')
  announcement.value = '请选择一个新的令字。'
}

function optionLabel(token: string) {
  const count = tokenCounts.value[token] ?? 0
  return count ? `令字「${token}」，可用 ${count} 句` : `令字「${token}」，暂无可用诗句`
}

onMounted(load)

onDeactivated(stopTimer)

onActivated(() => {
  if (phase.value === 'playing' && turn.value === 'player' && timerOn.value) {
    beginTicking()
  }
})

onBeforeUnmount(() => {
  stopTimer()
  stopAiTimer()
})
</script>

<template>
  <div class="wj-ff">
    <p v-if="loading" class="wj-empty" aria-busy="true">正在加载诗句索引（/indexes/lines.json）…</p>

    <div v-else-if="loadError" class="wj-empty" role="alert">
      <p>诗句索引加载失败（{{ loadError }}）。</p>
      <p>请确认构建产物 <code>/indexes/lines.json</code> 可访问。</p>
      <button type="button" class="wj-ff-btn" @click="load">重新加载</button>
    </div>

    <template v-else>
      <!-- 选令字 -->
      <section v-if="phase === 'setup'" class="wj-ff-setup" aria-labelledby="wj-ff-setup-title">
        <header class="wj-ff-hero">
          <p class="wj-ff-kicker">飞花令 · 人机对句</p>
          <h2 id="wj-ff-setup-title" class="wj-ff-title">选一枚令字，与 AI 轮流吟诗</h2>
          <p class="wj-ff-sub">
            从 {{ lines.length.toLocaleString('zh-CN') }} 句诗文中，说出含令字的真实诗句。
            你答对一题得 10 分；跳过或超时，AI 得 5 分并接一句。
          </p>
        </header>

        <div class="wj-ff-seals" role="group" aria-label="选择令字">
          <button
            v-for="token in TOKENS"
            :key="token"
            type="button"
            class="wj-ff-seal"
            :class="{ 'is-zero': !(tokenCounts[token] ?? 0) }"
            :disabled="!(tokenCounts[token] ?? 0)"
            :aria-label="optionLabel(token)"
            @click="startGame(token)"
          >
            <span class="wj-ff-seal-char" aria-hidden="true">{{ token }}</span>
            <span class="wj-ff-seal-n">{{ tokenCounts[token] ?? 0 }} 句</span>
          </button>
        </div>

        <p class="wj-ff-hint">
          判定只比较诗句内容，标点与空格会被忽略；可以只输入半句，但不少于 5 个字。
          同一句在本局中不能重复使用。
        </p>
      </section>

      <!-- 对局 -->
      <section v-else class="wj-ff-game" aria-labelledby="wj-ff-game-title">
        <header class="wj-ff-bar">
          <div class="wj-ff-seal-mini" aria-hidden="true">{{ selected }}</div>
          <div class="wj-ff-bar-main">
            <h2 id="wj-ff-game-title">飞花令 · 令字「{{ selected }}」</h2>
            <p>
              第 {{ round }} / {{ MAX_ROUNDS }} 轮 · 剩余可接
              <b>{{ remainingCount }}</b> 句 · 已用
              <b>{{ appearedLines.length }}</b> 句
            </p>
          </div>
          <div class="wj-ff-score" aria-label="当前比分">
            <span class="wj-ff-score-me"><b>{{ playerScore }}</b> 你</span>
            <span class="wj-ff-score-vs">:</span>
            <span class="wj-ff-score-ai"><b>{{ aiScore }}</b> AI</span>
          </div>
          <button type="button" class="wj-ff-btn wj-ff-btn-ghost" @click="changeToken">
            换令字
          </button>
        </header>

        <div v-if="phase === 'playing'" class="wj-ff-timer">
          <label class="wj-ff-switch">
            <input v-model="timerOn" type="checkbox" @change="onTimerToggle" />
            <span>30 秒倒计时</span>
          </label>
          <div
            v-if="timerOn"
            class="wj-ff-timerbar"
            role="progressbar"
            aria-label="本回合剩余时间"
            :aria-valuemin="0"
            :aria-valuemax="TURN_SECONDS"
            :aria-valuenow="seconds"
          >
            <span :style="{ width: timerPercent + '%' }"></span>
          </div>
          <span v-if="timerOn" class="wj-ff-secs" aria-hidden="true">{{ seconds }} 秒</span>
        </div>

        <div ref="flowEl" class="wj-ff-flow" aria-label="对句记录">
          <template v-for="item in flow" :key="item.id">
            <p v-if="item.kind === 'note'" class="wj-ff-sys">{{ item.text }}</p>
            <article v-else class="wj-ff-bubble" :class="item.who">
              <header class="wj-ff-bubble-head">
                <span class="wj-ff-who">{{ item.who === 'player' ? '你' : 'AI' }}</span>
                <span class="wj-ff-bubble-round">第 {{ item.round }} 轮</span>
              </header>
              <p class="wj-ff-line">{{ item.entry.line }}</p>
              <p class="wj-ff-meta">
                —— {{ item.entry.author }}{{ item.entry.titleText }}
                <span class="wj-ff-dynasty">{{ item.entry.dynasty }}</span>
                <a :href="item.entry.route" class="wj-ff-source">回源</a>
              </p>
              <p
                v-if="item.raw && normalizeText(item.raw) !== item.entry.norm"
                class="wj-ff-raw"
              >
                你输入：{{ item.raw }}
              </p>
            </article>
          </template>

          <p v-if="aiThinking" class="wj-ff-thinking" role="status">AI 正在寻句…</p>
          <p v-if="!flow.length && !aiThinking" class="wj-ff-flow-empty">
            对句台还空着，先来一句吧。
          </p>
        </div>

        <div v-if="phase === 'playing'" class="wj-ff-compose">
          <form class="wj-ff-form" @submit.prevent="submitAnswer">
            <label class="wj-ff-sr" for="wj-ff-input">输入含令字的诗句</label>
            <input
              id="wj-ff-input"
              v-model="input"
              type="text"
              class="wj-ff-input"
              :placeholder="`输入含「${selected}」的诗句，回车提交`"
              :disabled="inputDisabled"
              autocomplete="off"
              spellcheck="false"
            />
            <button type="submit" class="wj-ff-btn" :disabled="inputDisabled">提交</button>
            <button
              type="button"
              class="wj-ff-btn wj-ff-btn-ghost"
              :disabled="turn !== 'player' || aiThinking"
              @click="skipTurn('skip')"
            >
              跳过（AI +5）
            </button>
          </form>
          <p
            v-if="feedback"
            class="wj-ff-feedback"
            :class="`is-${feedbackKind}`"
            aria-live="polite"
          >
            {{ feedback }}
          </p>
          <p v-else class="wj-ff-feedback is-info">
            小提示：可以只输入半句，例如「{{ selected === '月' ? '床前明月光' : '含「' + selected + '」的任意诗句' }}」。
          </p>
        </div>

        <!-- 结算 -->
        <div v-else class="wj-ff-result" aria-labelledby="wj-ff-result-title">
          <h3 id="wj-ff-result-title">{{ outcomeTitle }}</h3>
          <p class="wj-ff-result-text">{{ endText }}</p>

          <div class="wj-ff-stats">
            <div class="wj-ff-stat">
              <b>{{ playerScore }}</b><span>你的得分</span>
            </div>
            <div class="wj-ff-stat">
              <b>{{ aiScore }}</b><span>AI 得分</span>
            </div>
            <div class="wj-ff-stat">
              <b>{{ playerHits }}</b><span>答对句数</span>
            </div>
            <div class="wj-ff-stat">
              <b>{{ skipCount }}</b><span>跳过次数</span>
            </div>
          </div>

          <div class="wj-ff-actions">
            <button type="button" class="wj-ff-btn" @click="replay">
              再来一局（令字{{ selected }}）
            </button>
            <button type="button" class="wj-ff-btn wj-ff-btn-ghost" @click="changeToken">
              换令字
            </button>
          </div>

          <h3 class="wj-ff-result-lines-title">
            本局诗句 · {{ appearedLines.length }} 句
          </h3>
          <p v-if="!appearedLines.length" class="wj-ff-hint">本局还没有出现诗句。</p>
          <ol v-else class="wj-ff-lines">
            <li v-for="(item, index) in appearedLines" :key="item.id" class="wj-ff-line-item">
              <span class="wj-ff-line-index">{{ index + 1 }}</span>
              <div class="wj-ff-line-body">
                <p class="wj-ff-line">{{ item.entry.line }}</p>
                <p class="wj-ff-meta">
                  <span class="wj-ff-source-who">{{ item.who === 'player' ? '你' : 'AI' }}</span>
                  —— {{ item.entry.author }}{{ item.entry.titleText }}
                  <span class="wj-ff-dynasty">{{ item.entry.dynasty }}</span>
                  <a :href="item.entry.route" class="wj-ff-source">回源</a>
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <p class="wj-ff-sr" role="status" aria-live="polite">{{ announcement }}</p>
    </template>
  </div>
</template>

<style scoped>
.wj-ff {
  --ff-gap: 14px;
  margin-top: 2px;
}

.wj-ff-setup,
.wj-ff-game {
  display: flex;
  flex-direction: column;
  gap: var(--ff-gap);
}

.wj-ff-hero {
  padding: 4px 0 2px;
}

.wj-ff-kicker {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
}

.wj-ff-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: clamp(20px, 3.2vw, 30px);
  line-height: 1.35;
  color: var(--wj-ink);
  letter-spacing: 0.02em;
}

.wj-ff-sub {
  margin: 8px 0 0;
  max-width: 68ch;
  color: var(--wj-ink-2);
  font-size: 14px;
  line-height: 1.75;
}

.wj-ff-seals {
  display: grid;
  grid-template-columns: repeat(10, minmax(64px, 1fr));
  gap: 12px;
}

.wj-ff-seal {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 104px;
  padding: 10px 6px;
  border: 2px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  color: var(--wj-accent);
  cursor: pointer;
  box-shadow: inset 0 0 0 3px var(--wj-card), inset 0 0 0 4px color-mix(in srgb, var(--wj-accent) 45%, transparent);
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  font-family: var(--wj-font-display);
}

.wj-ff-seal:hover:not(:disabled) {
  transform: translateY(-3px);
  border-color: var(--wj-accent-deep);
  box-shadow: inset 0 0 0 3px var(--wj-card),
    inset 0 0 0 4px color-mix(in srgb, var(--wj-accent) 65%, transparent),
    0 10px 24px color-mix(in srgb, var(--wj-accent) 16%, transparent);
}

.wj-ff-seal:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--wj-accent) 35%, transparent);
  outline-offset: 3px;
}

.wj-ff-seal.is-zero,
.wj-ff-seal:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  filter: grayscale(0.6);
}

.wj-ff-seal-char {
  font-size: clamp(30px, 3.4vw, 44px);
  line-height: 1.1;
  font-weight: var(--wj-display-weight);
  letter-spacing: 0;
}

.wj-ff-seal-n {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--wj-ink-2);
  font-family: var(--wj-font-body);
}

.wj-ff-hint {
  margin: 0;
  font-size: 13px;
  color: var(--wj-ink-3);
  line-height: 1.7;
}

.wj-ff-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}

.wj-ff-seal-mini {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  flex: none;
  border: 2px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 30px;
  line-height: 1;
  box-shadow: inset 0 0 0 2px var(--wj-card),
    inset 0 0 0 3px color-mix(in srgb, var(--wj-accent) 40%, transparent);
}

.wj-ff-bar-main {
  flex: 1 1 240px;
  min-width: 0;
}

.wj-ff-bar-main h2 {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 18px;
  color: var(--wj-ink);
}

.wj-ff-bar-main p {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--wj-ink-2);
}

.wj-ff-bar-main b {
  color: var(--wj-accent);
}

.wj-ff-score {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-bg);
  font-size: 12px;
  color: var(--wj-ink-2);
  white-space: nowrap;
}

.wj-ff-score b {
  font-size: 20px;
  color: var(--wj-ink);
  font-family: var(--wj-font-display);
}

.wj-ff-score-me b {
  color: var(--wj-accent);
}

.wj-ff-timer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px dashed var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: color-mix(in srgb, var(--wj-bg-soft) 70%, transparent);
}

.wj-ff-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--wj-ink-2);
  cursor: pointer;
  user-select: none;
}

.wj-ff-switch input {
  width: 15px;
  height: 15px;
  accent-color: var(--wj-accent);
}

.wj-ff-timerbar {
  flex: 1 1 140px;
  height: 6px;
  border-radius: 999px;
  background: var(--wj-line-soft);
  overflow: hidden;
}

.wj-ff-timerbar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--wj-accent);
  transition: width 0.3s linear;
}

.wj-ff-secs {
  min-width: 52px;
  text-align: right;
  font-size: 13px;
  color: var(--wj-ink-2);
  font-variant-numeric: tabular-nums;
}

.wj-ff-flow {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 440px;
  min-height: 150px;
  overflow-y: auto;
  padding: 6px 2px;
  scroll-behavior: smooth;
}

.wj-ff-bubble {
  max-width: min(78%, 640px);
  padding: 12px 15px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  animation: wjFfRise 0.24s ease both;
}

.wj-ff-bubble.player {
  align-self: flex-end;
  border-color: color-mix(in srgb, var(--wj-accent) 45%, var(--wj-line));
  background: color-mix(in srgb, var(--wj-accent-tint) 55%, var(--wj-card));
}

.wj-ff-bubble.ai {
  align-self: flex-start;
  border-left: 3px solid var(--wj-accent);
}

.wj-ff-bubble-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.wj-ff-who {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-weight: 700;
}

.wj-ff-bubble.ai .wj-ff-who {
  color: var(--wj-accent-deep);
}

.wj-ff-bubble-round {
  font-size: 10.5px;
  color: var(--wj-ink-3);
  letter-spacing: 0.08em;
}

.wj-ff-line {
  margin: 0;
  font-family: var(--wj-font-poem);
  font-size: clamp(17px, 2.2vw, 21px);
  line-height: 1.65;
  letter-spacing: 0.12em;
  color: var(--wj-ink);
  overflow-wrap: anywhere;
}

.wj-ff-meta {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--wj-ink-2);
  line-height: 1.6;
}

.wj-ff-dynasty {
  display: inline-block;
  margin: 0 6px;
  padding: 0 6px;
  border: 1px solid var(--wj-line);
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--wj-ink-3);
}

.wj-ff-source {
  margin-left: 4px;
  color: var(--wj-accent);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--wj-accent) 50%, transparent);
}

.wj-ff-source:hover {
  color: var(--wj-accent-deep);
}

.wj-ff-raw {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--wj-ink-3);
}

.wj-ff-sys {
  align-self: center;
  max-width: 88%;
  margin: 2px 0;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--wj-bg-soft);
  color: var(--wj-ink-3);
  font-size: 12px;
  text-align: center;
  line-height: 1.6;
  animation: wjFfRise 0.24s ease both;
}

.wj-ff-thinking {
  align-self: flex-start;
  margin: 0;
  padding: 6px 14px;
  border: 1px dashed var(--wj-line);
  border-radius: 999px;
  color: var(--wj-ink-3);
  font-size: 12.5px;
}

.wj-ff-flow-empty {
  margin: auto;
  color: var(--wj-ink-3);
  font-size: 13px;
  text-align: center;
}

.wj-ff-compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wj-ff-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.wj-ff-input {
  flex: 1 1 280px;
  min-width: 0;
  padding: 11px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  color: var(--wj-ink);
  font-size: 15px;
  font-family: var(--wj-font-body);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.wj-ff-input:focus {
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wj-accent) 18%, transparent);
}

.wj-ff-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.wj-ff-btn {
  padding: 9px 18px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-accent);
  color: #fff;
  font-size: 13.5px;
  font-family: var(--wj-font-display);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease,
    transform 0.15s ease;
}

.wj-ff-btn:hover:not(:disabled) {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
  transform: translateY(-1px);
}

.wj-ff-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wj-ff-btn-ghost {
  background: var(--wj-card);
  color: var(--wj-ink-2);
  border-color: var(--wj-line);
}

.wj-ff-btn-ghost:hover:not(:disabled) {
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}

.wj-ff-btn:focus-visible,
.wj-ff-seal:focus-visible,
.wj-ff-input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--wj-accent) 35%, transparent);
  outline-offset: 2px;
}

.wj-ff-feedback {
  margin: 0;
  min-height: 1.5em;
  font-size: 13px;
  line-height: 1.6;
}

.wj-ff-feedback.is-info {
  color: var(--wj-ink-3);
}

.wj-ff-feedback.is-ok {
  color: var(--wj-accent);
}

.wj-ff-feedback.is-error {
  color: #b43c2e;
}

:global([data-theme='ink']) .wj-ff-feedback.is-error {
  color: var(--wj-accent);
}

.wj-ff-result {
  padding: 18px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}

.wj-ff-result h3 {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 21px;
  color: var(--wj-ink);
}

.wj-ff-result-text {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--wj-ink-2);
  line-height: 1.6;
}

.wj-ff-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.wj-ff-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 6px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
}

.wj-ff-stat b {
  font-family: var(--wj-font-display);
  font-size: 24px;
  line-height: 1.1;
  color: var(--wj-accent);
}

.wj-ff-stat span {
  font-size: 11.5px;
  color: var(--wj-ink-3);
  letter-spacing: 0.08em;
}

.wj-ff-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.wj-ff-result-lines-title {
  margin-top: 22px !important;
  font-size: 15px !important;
}

.wj-ff-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.wj-ff-line-item {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--wj-line-soft);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
}

.wj-ff-line-index {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  font-size: 11px;
  font-family: var(--wj-font-display);
}

.wj-ff-line-body {
  min-width: 0;
}

.wj-ff-line-body .wj-ff-line {
  font-size: 15px;
  letter-spacing: 0.06em;
}

.wj-ff-source-who {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  font-size: 10.5px;
}

.wj-ff-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes wjFfRise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 主题差异：宣纸用双线印框，编辑部直角强框，少年派渐变描边 */
:global([data-theme='ink']) .wj-ff-seal,
:global([data-theme='ink']) .wj-ff-seal-mini {
  border-style: double;
  border-width: 3px;
  border-radius: 3px;
}

:global([data-theme='editorial']) .wj-ff-seal {
  border-radius: 0;
  box-shadow: inset 0 0 0 3px var(--wj-card), inset 0 0 0 4px var(--wj-ink);
  border-color: var(--wj-ink);
  color: var(--wj-ink);
}

:global([data-theme='editorial']) .wj-ff-seal-char {
  font-weight: 800;
}

:global([data-theme='youth']) .wj-ff-seal,
:global([data-theme='youth']) .wj-ff-seal-mini {
  border: 2px solid transparent;
  background: linear-gradient(var(--wj-card), var(--wj-card)) padding-box,
    var(--wj-grad) border-box;
  box-shadow: var(--wj-shadow);
}

@media (max-width: 900px) {
  .wj-ff-seals {
    grid-template-columns: repeat(5, minmax(58px, 1fr));
  }
  .wj-ff-seal {
    min-height: 90px;
  }
}

@media (max-width: 560px) {
  .wj-ff-seals {
    grid-template-columns: repeat(5, minmax(52px, 1fr));
    gap: 8px;
  }
  .wj-ff-seal {
    min-height: 78px;
    padding: 8px 3px;
  }
  .wj-ff-seal-char {
    font-size: 28px;
  }
  .wj-ff-seal-n {
    font-size: 10px;
  }
  .wj-ff-flow {
    max-height: 380px;
  }
  .wj-ff-bubble {
    max-width: 92%;
  }
  .wj-ff-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .wj-ff-form .wj-ff-btn {
    flex: 1 1 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wj-ff-bubble,
  .wj-ff-sys {
    animation: none;
  }
  .wj-ff-seal,
  .wj-ff-btn,
  .wj-ff-timerbar span,
  .wj-ff-input {
    transition: none;
  }
  .wj-ff-seal:hover:not(:disabled),
  .wj-ff-btn:hover:not(:disabled) {
    transform: none;
  }
  .wj-ff-flow {
    scroll-behavior: auto;
  }
}
</style>