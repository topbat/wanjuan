<script setup lang="ts">
/**
 * 万卷 · 成语接龙（人机对句）
 *
 * 数据源：/indexes/idioms.json（构建索引产物，370 条成语）
 * 规则：
 *   - 下一条成语的首字拼音必须等于上一条末字拼音（first / last，忽略声调）。
 *   - 校验顺序：① 是否在库内 ② 首字拼音是否匹配 ③ 本局是否已使用。
 *   - AI 优先从与上一条同语义场的未用成语中挑选；找不到同场时在全部候选中随机。
 *   - 提示只给 3 个可选首字，不直接给答案；「我不会」让 AI 接。
 *   - 连击统计与最长链记录（localStorage: wj-chain-best）。
 *
 * 交互：回车提交、Tab 可达、aria-live 播报。
 */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from 'vue'

type Idiom = {
  id: string
  word: string
  pinyin: string
  pinyinPlain: string
  first: string
  last: string
  meaning: string
  semanticField?: string | null
  srcPath: string
}

type ChainNode = {
  id: number
  kind: 'start' | 'player' | 'ai'
  idiom: Idiom
  route: string
  sameField?: boolean
}

const BASE = import.meta.env.BASE_URL
const BEST_KEY = 'wj-chain-best'
const FIELDS = [
  '勤奋励志', '品德修养', '诚信正直', '智慧谋略', '勇气毅力', '学习求知',
  '团结协作', '惜时进取', '家国情怀', '友情交往', '处世哲理', '景物描写', '其他',
]
const LEGACY_FIELD: Record<string, string> = {
  志向: '勤奋励志',
  勤奋: '勤奋励志',
  勇气: '勇气毅力',
  谋略: '智慧谋略',
  才学: '学习求知',
  诚信: '诚信正直',
  哲理: '处世哲理',
  '爱情·童年': '友情交往',
}

const idioms = ref<Idiom[]>([])
const loading = ref(true)
const loadError = ref('')

const phase = ref<'setup' | 'playing' | 'ended'>('setup')
const startInput = ref('')
const setupError = ref('')
const chain = ref<ChainNode[]>([])
const used = ref<Set<string>>(new Set())
const input = ref('')
const message = ref('')
const messageKind = ref<'info' | 'ok' | 'error'>('info')
const announcement = ref('')
const combo = ref(0)
const maxCombo = ref(0)
const best = ref(0)
const hint = ref<{ char: string; pinyin: string }[]>([])
const turn = ref<'player' | 'ai' | 'ended'>('player')
const aiThinking = ref(false)
const endReason = ref<'' | 'ai-stuck' | 'dead-end'>('')

const chainEl = ref<HTMLElement | null>(null)
let nodeSeq = 0
let aiTimerId = 0

const wordMap = computed(() => {
  const map = new Map<string, Idiom>()
  for (const it of idioms.value) map.set(it.word, it)
  return map
})

const byFirst = computed(() => {
  const map = new Map<string, Idiom[]>()
  for (const it of idioms.value) {
    if (!it.first) continue
    const list = map.get(it.first)
    if (list) list.push(it)
    else map.set(it.first, [it])
  }
  return map
})

const lastIdiom = computed<Idiom | null>(() => chain.value[chain.value.length - 1]?.idiom ?? null)
const expected = computed(() => lastIdiom.value?.last ?? '')
const lastChar = computed(() => Array.from(lastIdiom.value?.word ?? '').slice(-1)[0] ?? '')

const lastTone = computed(() => {
  const full = String(lastIdiom.value?.pinyin ?? '').trim().split(/\s+/)
  return full[full.length - 1] || expected.value
})

const inputDisabled = computed(
  () => phase.value !== 'playing' || turn.value !== 'player' || aiThinking.value,
)

const resultTitle = computed(() => {
  if (endReason.value === 'ai-stuck') return 'AI 接不上，你赢了'
  if (endReason.value === 'dead-end') return '这条链到头了'
  return '本局结束'
})

const resultText = computed(() => {
  if (endReason.value === 'ai-stuck') {
    return `成语库里已经没有首字读「${expected.value}」的未用成语，AI 选择认输。`
  }
  if (endReason.value === 'dead-end') {
    return `当前末字在库里已没有未使用的接龙候选，本局自然结束。`
  }
  return ''
})

function cleanWord(value: string): string {
  return String(value ?? '').trim().replace(/\s+/g, '')
}

function toRoute(srcPath: string): string {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

function fieldOf(it: Idiom): string {
  const raw = String(it.semanticField ?? '').trim()
  if (!raw) return '其他'
  return FIELDS.includes(raw) ? raw : (LEGACY_FIELD[raw] ?? '其他')
}

function semanticLabel(it: Idiom): string {
  return String(it.semanticField ?? '').trim() || '其他'
}

function candidatesFor(prev: Idiom | null | undefined): Idiom[] {
  if (!prev) return []
  return (byFirst.value.get(prev.last) ?? []).filter((it) => !used.value.has(it.word))
}

function hasOutgoing(it: Idiom): boolean {
  return (byFirst.value.get(it.last) ?? []).some((next) => next.word !== it.word)
}

function scrollChain() {
  void nextTick(() => {
    const el = chainEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function setMessage(text: string, kind: 'info' | 'ok' | 'error') {
  message.value = text
  messageKind.value = kind
}

function setError(text: string) {
  combo.value = 0
  hint.value = []
  setMessage(text, 'error')
  announcement.value = `接龙未通过：${text}`
}

function readBest() {
  try {
    const raw = window.localStorage.getItem(BEST_KEY)
    const value = Number(raw)
    if (Number.isFinite(value) && value > 0) best.value = Math.floor(value)
  } catch {
    // localStorage 不可用时静默降级
  }
}

function updateBest() {
  if (chain.value.length <= best.value) return
  best.value = chain.value.length
  try {
    window.localStorage.setItem(BEST_KEY, String(best.value))
  } catch {
    // localStorage 不可用时静默降级
  }
}

function appendNode(idiom: Idiom, kind: 'start' | 'player' | 'ai', sameField = false) {
  nodeSeq += 1
  chain.value.push({
    id: nodeSeq,
    kind,
    idiom,
    route: toRoute(idiom.srcPath),
    sameField,
  })
  const next = new Set(used.value)
  next.add(idiom.word)
  used.value = next
  scrollChain()
}

function begin(idiom: Idiom) {
  window.clearTimeout(aiTimerId)
  aiTimerId = 0
  nodeSeq = 0
  phase.value = 'playing'
  chain.value = []
  used.value = new Set()
  combo.value = 0
  maxCombo.value = 0
  hint.value = []
  input.value = ''
  setupError.value = ''
  startInput.value = ''
  endReason.value = ''
  turn.value = 'player'
  aiThinking.value = false
  appendNode(idiom, 'start')
  setMessage(
    `开局「${idiom.word}」。请接一个首字读「${idiom.last}」的成语。`,
    'info',
  )
  announcement.value = `接龙开始。起始成语「${idiom.word}」，拼音 ${idiom.pinyin}。它的末字读「${idiom.last}」，请接一个首字同音的成语。`
}

function startRandom() {
  if (!idioms.value.length) return
  const viable = idioms.value.filter((it) => hasOutgoing(it))
  const pool = viable.length ? viable : idioms.value
  let pick = pool[Math.floor(Math.random() * pool.length)]
  if (pick && lastIdiom.value && pick.word === lastIdiom.value.word && pool.length > 1) {
    pick = pool[(pool.indexOf(pick) + 1) % pool.length]
  }
  if (pick) begin(pick)
}

function startSpecified() {
  const word = cleanWord(startInput.value)
  if (!word) {
    setupError.value = '请输入一个起始成语，或直接点「随机开局」。'
    return
  }
  const idiom = wordMap.value.get(word)
  if (!idiom) {
    setupError.value = `「${word}」不在成语库（共 ${idioms.value.length} 条）中，请换一个。`
    return
  }
  begin(idiom)
}

function resetToSetup() {
  window.clearTimeout(aiTimerId)
  aiTimerId = 0
  phase.value = 'setup'
  chain.value = []
  used.value = new Set()
  combo.value = 0
  maxCombo.value = 0
  hint.value = []
  input.value = ''
  message.value = ''
  setupError.value = ''
  endReason.value = ''
  turn.value = 'player'
  aiThinking.value = false
  announcement.value = '请选择或输入一个起始成语。'
}

function submitAnswer() {
  if (inputDisabled.value) return
  const word = cleanWord(input.value)
  if (!word) {
    setError('请先输入一个成语。')
    return
  }
  const idiom = wordMap.value.get(word)
  if (!idiom) {
    setError(`「${word}」不在成语库（共 ${idioms.value.length} 条）中，请换一个。`)
    return
  }
  const prev = lastIdiom.value
  if (!prev) return
  if (idiom.first !== prev.last) {
    setError(
      `「${idiom.word}」的首字拼音「${idiom.first}」与上一条「${prev.word}」的末字拼音「${prev.last}」不一致，接不上。`,
    )
    return
  }
  if (used.value.has(idiom.word)) {
    setError(`「${idiom.word}」本局已经用过，不能重复。`)
    return
  }
  acceptPlayer(idiom)
}

function acceptPlayer(idiom: Idiom) {
  appendNode(idiom, 'player')
  combo.value += 1
  if (combo.value > maxCombo.value) maxCombo.value = combo.value
  input.value = ''
  hint.value = []
  updateBest()

  setMessage(
    `接上了！链长 ${chain.value.length} 条，当前连击 ${combo.value}。`,
    'ok',
  )
  announcement.value = `「${idiom.word}」接上了，连击 ${combo.value}。AI 开始接龙。`

  if (!candidatesFor(idiom).length) {
    finish('dead-end')
    return
  }
  scheduleAi(680)
}

function pickAiEntry(candidates: Idiom[], prev: Idiom): Idiom {
  const sameField = candidates.filter((it) => fieldOf(it) === fieldOf(prev))
  const pool = sameField.length ? sameField : candidates
  return pool[Math.floor(Math.random() * pool.length)]
}

function scheduleAi(delay = 650) {
  turn.value = 'ai'
  aiThinking.value = true
  window.clearTimeout(aiTimerId)
  aiTimerId = window.setTimeout(runAiTurn, delay)
}

function runAiTurn() {
  aiTimerId = 0
  if (phase.value !== 'playing') return
  const prev = lastIdiom.value
  const candidates = candidatesFor(prev)
  aiThinking.value = false

  if (!prev || !candidates.length) {
    finish('ai-stuck')
    return
  }

  const picked = pickAiEntry(candidates, prev)
  const same = fieldOf(picked) === fieldOf(prev)
  appendNode(picked, 'ai', same)
  updateBest()
  hint.value = []

  if (!candidatesFor(picked).length) {
    finish('dead-end')
    return
  }

  turn.value = 'player'
  setMessage(
    `AI 接「${picked.word}」${same ? '（同语义场）' : ''}。轮到你接「${picked.last}」音。`,
    'info',
  )
  announcement.value = `AI 接「${picked.word}」，${same ? '同语义场，' : ''}释义：${picked.meaning}。请接一个首字读「${picked.last}」的成语。`
}

function finish(reason: 'ai-stuck' | 'dead-end') {
  window.clearTimeout(aiTimerId)
  aiTimerId = 0
  aiThinking.value = false
  turn.value = 'ended'
  phase.value = 'ended'
  endReason.value = reason
  hint.value = []
  const title = reason === 'ai-stuck' ? 'AI 接不上，你赢了' : '这条链到头了'
  setMessage(title, reason === 'ai-stuck' ? 'ok' : 'info')
  announcement.value = `本局结束，${title}。链长 ${chain.value.length} 条，本局最高连击 ${maxCombo.value}，历史最长链 ${best.value} 条。`
  scrollChain()
}

function giveUp() {
  if (phase.value !== 'playing' || turn.value !== 'player' || aiThinking.value) return
  combo.value = 0
  hint.value = []
  input.value = ''
  const prev = lastIdiom.value
  if (!prev || !candidatesFor(prev).length) {
    finish('ai-stuck')
    return
  }
  setMessage('你选择「我不会」，AI 继续接一句。', 'info')
  announcement.value = '你选择跳过，AI 继续接龙。'
  scheduleAi(480)
}

function showHint() {
  if (phase.value !== 'playing' || turn.value !== 'player' || aiThinking.value) return
  const prev = lastIdiom.value
  const candidates = candidatesFor(prev)
  if (!candidates.length) {
    setError(`库里暂时没有首字读「${expected.value}」的未用成语了。`)
    return
  }

  const unique = new Map<string, { char: string; pinyin: string }>()
  const shuffled = [...candidates].sort(() => Math.random() - 0.5)
  for (const it of shuffled) {
    const char = Array.from(it.word)[0] ?? ''
    if (!char || unique.has(char)) continue
    const tone = String(it.pinyin ?? '').trim().split(/\s+/)[0] || it.first
    unique.set(char, { char, pinyin: tone })
    if (unique.size >= 3) break
  }
  hint.value = [...unique.values()]

  const chars = hint.value.map((item) => item.char).join('、')
  setMessage(`可选首字：${chars}。只给首字，完整成语还要你来想。`, 'info')
  announcement.value = `提示：可以接的成语首字有 ${chars}，都读「${expected.value}」音。`
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${BASE}indexes/idioms.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const items: Idiom[] = Array.isArray(data) ? data : (data.items ?? [])
    idioms.value = items.filter((it) => String(it.word ?? '').trim())
  } catch (err: any) {
    loadError.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  readBest()
  void load()
})

onBeforeUnmount(() => {
  window.clearTimeout(aiTimerId)
})
</script>

<template>
  <div class="wj-ic">
    <p v-if="loading" class="wj-empty" aria-busy="true">正在加载成语索引（/indexes/idioms.json）…</p>

    <div v-else-if="loadError" class="wj-empty" role="alert">
      <p>成语索引加载失败（{{ loadError }}）。</p>
      <p>请确认构建产物 <code>/indexes/idioms.json</code> 可访问。</p>
      <button type="button" class="wj-ic-btn" @click="load">重新加载</button>
    </div>

    <template v-else>
      <!-- 开局 -->
      <section v-if="phase === 'setup'" class="wj-ic-setup" aria-labelledby="wj-ic-setup-title">
        <header class="wj-ic-hero">
          <p class="wj-ic-kicker">成语接龙 · 首尾相衔</p>
          <h2 id="wj-ic-setup-title" class="wj-ic-title">首字读音，接上一条的末字</h2>
          <p class="wj-ic-sub">
            从 {{ idioms.length }} 条成语中任选一条开局。下一条成语的首字拼音，必须与上一条末字拼音相同（忽略声调）。
            例如「一心一意」的末字读 yi，就可以接「一往无前」。
          </p>
        </header>

        <div class="wj-ic-rules">
          <p><b>①</b> 必须在成语库内 <b>②</b> 首字拼音相同 <b>③</b> 本局不能重复</p>
          <p class="wj-ic-rule-note">
            AI 会优先挑选与上一条同语义场的成语；提示只给 3 个可选首字，不直接给答案。
          </p>
        </div>

        <form class="wj-ic-start" @submit.prevent="startSpecified">
          <label class="wj-ic-sr" for="wj-ic-start-input">指定起始成语</label>
          <input
            id="wj-ic-start-input"
            v-model="startInput"
            type="text"
            class="wj-ic-input"
            placeholder="输入起始成语，如「一心一意」；留空可随机"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="submit" class="wj-ic-btn">开始接龙</button>
          <button type="button" class="wj-ic-btn wj-ic-btn-ghost" @click="startRandom">
            随机开局
          </button>
        </form>
        <p v-if="setupError" class="wj-ic-feedback is-error" role="alert">{{ setupError }}</p>
        <p class="wj-ic-hint">
          最长链记录保存在本机浏览器（localStorage：<code>wj-chain-best</code>）。
        </p>
      </section>

      <!-- 对局 -->
      <section v-else class="wj-ic-game" aria-labelledby="wj-ic-game-title">
        <header class="wj-ic-bar">
          <div class="wj-ic-bar-main">
            <p class="wj-ic-kicker">成语接龙 · 首尾相衔</p>
            <h2 id="wj-ic-game-title">
              接住「{{ lastIdiom?.word }}」的尾音
              <span class="wj-ic-pinyin">{{ expected }}</span>
            </h2>
            <p class="wj-ic-expected">
              末字「{{ lastChar }}」读 {{ lastTone }} → 下一条首字须读
              <b>{{ expected }}</b>（不计声调）
            </p>
          </div>
          <div class="wj-ic-stats" aria-label="接龙统计">
            <span class="wj-ic-stat"><b>{{ chain.length }}</b>链长</span>
            <span class="wj-ic-stat"><b>{{ combo }}</b>连击</span>
            <span class="wj-ic-stat"><b>{{ maxCombo }}</b>本局最高</span>
            <span class="wj-ic-stat wj-ic-stat-best"><b>{{ best || '—' }}</b>最长链</span>
          </div>
          <button type="button" class="wj-ic-btn wj-ic-btn-ghost" @click="resetToSetup">
            重开
          </button>
        </header>

        <div class="wj-ic-chain-wrap">
          <ol ref="chainEl" class="wj-ic-chain" aria-label="接龙链">
            <li
              v-for="(node, index) in chain"
              :key="node.id"
              class="wj-ic-node"
              :class="node.kind"
            >
              <span class="wj-ic-node-num" aria-hidden="true">{{ index + 1 }}</span>
              <article class="wj-ic-card">
                <header class="wj-ic-card-head">
                  <span class="wj-ic-word">{{ node.idiom.word }}</span>
                  <span class="wj-ic-py">{{ node.idiom.pinyin }}</span>
                  <span class="wj-ic-badge">
                    {{ node.kind === 'start' ? '起始' : node.kind === 'player' ? '你' : 'AI' }}
                  </span>
                </header>
                <p class="wj-ic-meaning" :title="node.idiom.meaning">{{ node.idiom.meaning }}</p>
                <footer class="wj-ic-card-foot">
                  <span class="wj-ic-field">{{ semanticLabel(node.idiom) }}</span>
                  <span v-if="node.sameField" class="wj-ic-same">同语义场</span>
                  <a :href="node.route" class="wj-ic-source">词条 →</a>
                </footer>
              </article>
            </li>
          </ol>
        </div>

        <div v-if="phase === 'playing'" class="wj-ic-compose">
          <div class="wj-ic-turnline">
            <span v-if="turn === 'player' && !aiThinking">
              轮到你：首字读 <b>{{ expected }}</b>
            </span>
            <span v-else-if="aiThinking" class="wj-ic-thinking">AI 正在接龙…</span>
            <span v-else>请稍候…</span>
          </div>

          <form class="wj-ic-form" @submit.prevent="submitAnswer">
            <label class="wj-ic-sr" for="wj-ic-input">输入下一个成语</label>
            <input
              id="wj-ic-input"
              v-model="input"
              type="text"
              class="wj-ic-input"
              :placeholder="`输入首字读「${expected}」的成语，回车提交`"
              :disabled="inputDisabled"
              autocomplete="off"
              spellcheck="false"
            />
            <button type="submit" class="wj-ic-btn" :disabled="inputDisabled">接龙</button>
            <button
              type="button"
              class="wj-ic-btn wj-ic-btn-ghost"
              :disabled="inputDisabled"
              @click="showHint"
            >
              提示
            </button>
            <button
              type="button"
              class="wj-ic-btn wj-ic-btn-ghost"
              :disabled="inputDisabled"
              @click="giveUp"
            >
              我不会
            </button>
          </form>

          <div v-if="hint.length" class="wj-ic-hints" aria-label="可选首字提示">
            <span class="wj-ic-hints-label">可选首字：</span>
            <span v-for="item in hint" :key="item.char" class="wj-ic-hint-chip">
              {{ item.char }}<em>{{ item.pinyin }}</em>
            </span>
            <span class="wj-ic-hints-note">只给首字，不直接给答案</span>
          </div>

          <p v-if="message" class="wj-ic-feedback" :class="`is-${messageKind}`">
            {{ message }}
          </p>
        </div>

        <div v-else class="wj-ic-result" aria-labelledby="wj-ic-result-title">
          <h3 id="wj-ic-result-title">{{ resultTitle }}</h3>
          <p class="wj-ic-result-text">{{ resultText }}</p>
          <div class="wj-ic-result-stats">
            <div class="wj-ic-result-stat">
              <b>{{ chain.length }}</b><span>本局链长</span>
            </div>
            <div class="wj-ic-result-stat">
              <b>{{ maxCombo }}</b><span>最高连击</span>
            </div>
            <div class="wj-ic-result-stat">
              <b>{{ best }}</b><span>历史最长链</span>
            </div>
          </div>
          <div class="wj-ic-actions">
            <button type="button" class="wj-ic-btn" @click="startRandom">随机再来一局</button>
            <button type="button" class="wj-ic-btn wj-ic-btn-ghost" @click="resetToSetup">
              指定起始成语
            </button>
          </div>
        </div>
      </section>

      <p class="wj-ic-sr" role="status" aria-live="polite">{{ announcement }}</p>
    </template>
  </div>
</template>

<style scoped>
.wj-ic {
  margin-top: 2px;
}

.wj-ic-setup,
.wj-ic-game {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wj-ic-hero {
  padding: 4px 0 2px;
}

.wj-ic-kicker {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
}

.wj-ic-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: clamp(20px, 3.2vw, 30px);
  line-height: 1.35;
  color: var(--wj-ink);
  letter-spacing: 0.02em;
}

.wj-ic-sub {
  margin: 8px 0 0;
  max-width: 72ch;
  color: var(--wj-ink-2);
  font-size: 14px;
  line-height: 1.75;
}

.wj-ic-rules {
  padding: 13px 16px;
  border: 1px solid var(--wj-line);
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-size: 13.5px;
  line-height: 1.8;
}

.wj-ic-rules p {
  margin: 0;
}

.wj-ic-rules b {
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
}

.wj-ic-rule-note {
  margin-top: 4px !important;
  font-size: 12.5px;
  color: var(--wj-ink-3);
}

.wj-ic-start {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wj-ic-input {
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

.wj-ic-input:focus {
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wj-accent) 18%, transparent);
}

.wj-ic-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.wj-ic-btn {
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

.wj-ic-btn:hover:not(:disabled) {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
  transform: translateY(-1px);
}

.wj-ic-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.wj-ic-btn-ghost {
  background: var(--wj-card);
  color: var(--wj-ink-2);
  border-color: var(--wj-line);
}

.wj-ic-btn-ghost:hover:not(:disabled) {
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}

.wj-ic-btn:focus-visible,
.wj-ic-input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--wj-accent) 35%, transparent);
  outline-offset: 2px;
}

.wj-ic-hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--wj-ink-3);
  line-height: 1.7;
}

.wj-ic-hint code {
  font-size: 12px;
}

.wj-ic-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 15px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}

.wj-ic-bar-main {
  flex: 1 1 260px;
  min-width: 0;
}

.wj-ic-bar-main h2 {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 18px;
  line-height: 1.45;
  color: var(--wj-ink);
}

.wj-ic-pinyin {
  display: inline-block;
  margin-left: 4px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--wj-accent) 40%, var(--wj-line));
  border-radius: 999px;
  color: var(--wj-accent);
  font-size: 14px;
  letter-spacing: 0.08em;
  font-family: var(--wj-font-mono);
}

.wj-ic-expected {
  margin: 5px 0 0;
  font-size: 12.5px;
  color: var(--wj-ink-2);
  line-height: 1.6;
}

.wj-ic-expected b {
  color: var(--wj-accent);
}

.wj-ic-stats {
  display: flex;
  align-items: stretch;
  gap: 6px;
  flex-wrap: wrap;
}

.wj-ic-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-bg);
  color: var(--wj-ink-3);
  font-size: 11px;
  white-space: nowrap;
}

.wj-ic-stat b {
  color: var(--wj-ink);
  font-size: 16px;
  font-family: var(--wj-font-display);
}

.wj-ic-stat-best b {
  color: var(--wj-accent);
}

.wj-ic-chain-wrap {
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: color-mix(in srgb, var(--wj-bg-soft) 55%, transparent);
  padding: 12px 12px 12px 16px;
}

.wj-ic-chain {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 46vh;
  min-height: 150px;
  overflow-y: auto;
  margin: 0;
  padding: 2px 4px 2px 0;
  list-style: none;
  scroll-behavior: smooth;
}

.wj-ic-chain::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 15px;
  width: 1px;
  background: var(--wj-line);
  pointer-events: none;
}

.wj-ic-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.wj-ic-node-num {
  position: relative;
  z-index: 1;
  flex: none;
  width: 28px;
  height: 28px;
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--wj-line);
  border-radius: 999px;
  background: var(--wj-card);
  color: var(--wj-ink-3);
  font-size: 11px;
  font-family: var(--wj-font-display);
}

.wj-ic-node.player .wj-ic-node-num {
  border-color: var(--wj-accent);
  background: var(--wj-accent);
  color: #fff;
}

.wj-ic-node.ai .wj-ic-node-num {
  border-color: color-mix(in srgb, var(--wj-accent) 45%, var(--wj-line));
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
}

.wj-ic-card {
  flex: 1 1 auto;
  min-width: 0;
  padding: 10px 13px 9px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  animation: wjIcRise 0.22s ease both;
}

.wj-ic-node.start .wj-ic-card {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--wj-accent) 55%, var(--wj-line));
  background: color-mix(in srgb, var(--wj-accent-tint) 45%, var(--wj-card));
}

.wj-ic-node.player .wj-ic-card {
  border-left-width: 3px;
  border-left-color: var(--wj-accent);
}

.wj-ic-node.ai .wj-ic-card {
  border-left: 3px solid color-mix(in srgb, var(--wj-accent) 45%, var(--wj-line));
}

.wj-ic-card-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.wj-ic-word {
  font-family: var(--wj-font-display);
  font-size: 18px;
  letter-spacing: 0.08em;
  color: var(--wj-ink);
  font-weight: var(--wj-display-weight);
}

.wj-ic-py {
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-mono);
}

.wj-ic-badge {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wj-bg);
  border: 1px solid var(--wj-line);
  color: var(--wj-ink-3);
  font-size: 10.5px;
  letter-spacing: 0.08em;
}

.wj-ic-node.player .wj-ic-badge {
  border-color: color-mix(in srgb, var(--wj-accent) 45%, var(--wj-line));
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}

.wj-ic-node.ai .wj-ic-badge {
  color: var(--wj-accent-deep);
}

.wj-ic-meaning {
  margin: 5px 0 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--wj-ink-2);
  font-size: 12.5px;
  line-height: 1.6;
}

.wj-ic-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
}

.wj-ic-field {
  padding: 1px 8px;
  border: 1px solid var(--wj-line-soft);
  border-radius: 999px;
  color: var(--wj-ink-3);
  font-size: 10.5px;
}

.wj-ic-same {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  font-size: 10.5px;
}

.wj-ic-source {
  margin-left: auto;
  color: var(--wj-accent);
  font-size: 11.5px;
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--wj-accent) 50%, transparent);
}

.wj-ic-source:hover {
  color: var(--wj-accent-deep);
}

.wj-ic-compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wj-ic-turnline {
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-ic-turnline b {
  color: var(--wj-accent);
  font-family: var(--wj-font-mono);
}

.wj-ic-thinking {
  color: var(--wj-ink-3);
}

.wj-ic-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wj-ic-hints {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  padding: 8px 12px;
  border: 1px dashed var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
}

.wj-ic-hints-label {
  font-size: 12.5px;
  color: var(--wj-ink-2);
}

.wj-ic-hint-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--wj-line);
  border-radius: 999px;
  background: var(--wj-card);
  color: var(--wj-ink);
  font-family: var(--wj-font-display);
  font-size: 14px;
}

.wj-ic-hint-chip em {
  font-style: normal;
  font-size: 10px;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-mono);
}

.wj-ic-hints-note {
  margin-left: auto;
  font-size: 11px;
  color: var(--wj-ink-3);
}

.wj-ic-feedback {
  margin: 0;
  min-height: 1.4em;
  font-size: 13px;
  line-height: 1.65;
}

.wj-ic-feedback.is-info {
  color: var(--wj-ink-3);
}

.wj-ic-feedback.is-ok {
  color: var(--wj-accent);
}

.wj-ic-feedback.is-error {
  color: #b43c2e;
}

:global([data-theme='ink']) .wj-ic-feedback.is-error {
  color: var(--wj-accent);
}

.wj-ic-result {
  padding: 18px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  animation: wjIcRise 0.24s ease both;
}

.wj-ic-result h3 {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 21px;
  color: var(--wj-ink);
}

.wj-ic-result-text {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--wj-ink-2);
  line-height: 1.65;
}

.wj-ic-result-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.wj-ic-result-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 6px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
}

.wj-ic-result-stat b {
  font-family: var(--wj-font-display);
  font-size: 24px;
  line-height: 1.1;
  color: var(--wj-accent);
}

.wj-ic-result-stat span {
  font-size: 11.5px;
  color: var(--wj-ink-3);
  letter-spacing: 0.08em;
}

.wj-ic-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.wj-ic-sr {
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

@keyframes wjIcRise {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 主题差异 */
:global([data-theme='ink']) .wj-ic-rules {
  border-left-width: 2px;
}
:global([data-theme='ink']) .wj-ic-card {
  border-radius: 3px;
}
:global([data-theme='editorial']) .wj-ic-card {
  border-radius: 0;
  border-left-width: 2px;
}
:global([data-theme='editorial']) .wj-ic-node.player .wj-ic-card {
  border-left-width: 4px;
}
:global([data-theme='youth']) .wj-ic-card {
  border-width: 2px;
  border-color: var(--wj-line-soft);
}
:global([data-theme='youth']) .wj-ic-node.start .wj-ic-card {
  border-color: color-mix(in srgb, var(--wj-accent) 45%, var(--wj-line));
}

@media (max-width: 700px) {
  .wj-ic-stats {
    order: 3;
    width: 100%;
  }
  .wj-ic-chain {
    max-height: 40vh;
  }
  .wj-ic-form .wj-ic-btn {
    flex: 1 1 auto;
  }
  .wj-ic-result-stats {
    grid-template-columns: 1fr;
  }
  .wj-ic-hints-note {
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wj-ic-card,
  .wj-ic-result {
    animation: none;
  }
  .wj-ic-btn,
  .wj-ic-input {
    transition: none;
  }
  .wj-ic-btn:hover:not(:disabled) {
    transform: none;
  }
  .wj-ic-chain {
    scroll-behavior: auto;
  }
}
</style>