<script setup lang="ts">
/**
 * 万卷 · 问书库（/ask/）
 *
 * 产品形态：先检索，后生成。
 *   - 检索：浏览器内读 /indexes/*.json，中文 bigram + 拼音/首字母 + 主题扩展，
 *     三路召回（诗句 / 名句 / 条目），无需任何模型即可使用；
 *   - 生成：可选连接用户本机 Ollama（OpenAI 兼容 /v1/chat/completions），
 *     Top 8 片段作为 context，SSE 流式渲染；失败自动降级为仅检索结果；
 *   - 隐私：检索全在本地；只有配置了 Ollama 才向该本机服务发送问题与片段；
 *     配置只存 localStorage（wj-rag-config），不内置 API Key，不请求第三方网络。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  analyzeQuery,
  buildUserPrompt,
  citationsFromHits,
  describeOllamaError,
  loadCorpus,
  normalizeOllamaBase,
  probeOllama,
  relevancePercent,
  retrieve,
  streamOllamaChat,
  SYSTEM_PROMPT,
  validateOllamaBase,
  type ChatDeltaMessage,
  type Citation,
  type Corpus,
  type EntryType,
  type Hit,
  type QueryPlan,
  type RagResult,
} from '../composables/useRag'

type ConnState = 'idle' | 'checking' | 'ok' | 'fail'
type MsgState = 'thinking' | 'ready' | 'generating' | 'done' | 'fallback' | 'stopped'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  state?: MsgState
  question?: string
  plan?: QueryPlan
  hits?: RagResult
  contextHits?: Hit[]
  citations?: Citation[]
  streaming?: boolean
  notice?: string
  error?: string
  degraded?: boolean
}

const CONFIG_KEY = 'wj-rag-config'
const DEFAULT_BASE = 'http://localhost:11434'
const DEFAULT_MODEL = 'qwen2.5:7b'

const TYPE_LABEL: Record<EntryType, string> = {
  poem: '作品',
  idiom: '成语',
  quote: '名句',
  author: '作者',
  imagery: '意象',
}

const EXAMPLES = [
  { q: '李白的送别诗有哪些', label: '李白的送别诗有哪些', needsModel: false },
  { q: '含“月”的思乡名句', label: '含「月」的思乡名句', needsModel: false },
  { q: '形容坚持的成语', label: '形容坚持的成语', needsModel: false },
  { q: '描写春天的诗句', label: '描写春天的诗句', needsModel: false },
  { q: '苏轼和辛弃疾的词风差异', label: '苏轼和辛弃疾的词风差异', needsModel: true },
]

const corpus = ref<Corpus | null>(null)
const corpusLoading = ref(true)
const corpusError = ref('')

const config = reactive({ base: DEFAULT_BASE, model: DEFAULT_MODEL, enabled: false })
const configReady = ref(false)
const settingsOpen = ref(false)
const baseTouched = ref(false)

const conn = reactive({
  state: 'idle' as ConnState,
  models: [] as string[],
  error: '',
  checkedAt: 0,
})

const messages = ref<ChatMessage[]>([])
const input = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const busy = computed(() => messages.value.some((m) => m.streaming))

let uid = 0
let activeAbort: AbortController | null = null
let activeMsg: ChatMessage | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let scrollRaf = 0
let probeToken = 0
let probePromise: Promise<boolean> | null = null

const baseError = computed(() => validateOllamaBase(config.base))
const showBaseError = computed(() => (baseTouched.value || conn.state === 'fail') && !!baseError.value)
const mixedContent = computed(
  () =>
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    normalizeOllamaBase(config.base).startsWith('http://'),
)
const connShort = computed(() => {
  if (conn.state === 'checking') return '检测中…'
  if (conn.state === 'ok') return `Ollama 已连接 · ${conn.models.length} 个模型`
  if (conn.state === 'fail') return '未连接 · 仅本地检索'
  return '未检测 Ollama'
})
const composerHint = computed(() => {
  if (conn.state === 'checking') return '正在检测本机 Ollama…'
  if (conn.state === 'ok') return `本机 Ollama · ${config.model || '未命名模型'}`
  return '未连接模型也可检索'
})
const corpusStats = computed(() => {
  const c = corpus.value?.counts
  if (!c) return ''
  return `已载入 ${c.poem} 作品 · ${c.idiom} 成语 · ${c.quote} 名句 · ${c.author} 作者 · ${c.imagery} 意象 · ${c.lines} 诗句`
})

/* ------------------------------------------------------------------ */
/* 配置持久化                                                          */
/* ------------------------------------------------------------------ */

function scheduleSave() {
  if (!configReady.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        CONFIG_KEY,
        JSON.stringify({
          base: config.base.trim(),
          model: config.model.trim(),
          enabled: config.enabled,
        }),
      )
    } catch {
      /* 隐私模式或存储已满：静默失败，不影响检索 */
    }
  }, 200)
}

watch([() => config.base, () => config.model, () => config.enabled], scheduleSave)

// 地址被编辑后，上一次的连接结论立即失效（下次提问会重新探测）
watch(
  () => config.base,
  () => {
    if (!configReady.value) return
    if (conn.state === 'checking') {
      probeToken += 1
      probePromise = null
    }
    conn.state = 'idle'
    conn.error = ''
    conn.models = []
    conn.checkedAt = 0
  },
)

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (typeof saved?.base === 'string' && saved.base.trim()) config.base = saved.base.trim()
    if (typeof saved?.model === 'string' && saved.model.trim()) config.model = saved.model.trim()
    config.enabled = saved?.enabled === true
  } catch {
    /* 配置损坏时使用默认值 */
  }
}

/* ------------------------------------------------------------------ */
/* 语料加载                                                            */
/* ------------------------------------------------------------------ */

async function ensureCorpus() {
  if (corpus.value) return
  corpusLoading.value = true
  try {
    corpus.value = await loadCorpus()
    corpusError.value = ''
  } catch (err: any) {
    corpusError.value = err?.message
      ? `本地索引加载失败（${err.message}）。请先运行 npm run build:index 生成 site/public/indexes/*.json。`
      : '本地索引加载失败。请先运行 npm run build:index。'
    throw err
  } finally {
    corpusLoading.value = false
  }
}

/* ------------------------------------------------------------------ */
/* Ollama 连接检测                                                     */
/* ------------------------------------------------------------------ */

async function checkConnection(opts: { silent?: boolean; timeoutMs?: number } = {}): Promise<boolean> {
  if (probePromise) return probePromise

  const invalid = validateOllamaBase(config.base)
  if (invalid) {
    conn.state = 'fail'
    conn.error = invalid
    conn.models = []
    probeToken += 1
    return false
  }

  conn.state = 'checking'
  conn.error = ''
  const token = ++probeToken

  const current = (async () => {
    const result = await probeOllama(config.base, opts.timeoutMs ?? 5000)
    if (token !== probeToken) return false

    conn.checkedAt = Date.now()
    conn.models = result.models
    if (result.ok) {
      conn.state = 'ok'
      conn.error = result.models.length ? '' : '已连接，但尚未安装模型'
      // 记录「用户曾成功连接」：刷新后首次提问才自动探测，避免默认静默请求本机
      config.enabled = true
      if (!config.model.trim() && result.models[0]) config.model = result.models[0]
      return true
    }
    conn.state = 'fail'
    conn.error = result.error
    return false
  })()
  probePromise = current

  try {
    return await current
  } finally {
    if (probePromise === current) probePromise = null
  }
}

/* ------------------------------------------------------------------ */
/* 对话与检索                                                          */
/* ------------------------------------------------------------------ */

const TYPE_ROUTE_LABEL = TYPE_LABEL

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${Math.min(140, el.scrollHeight)}px`
}

function resetTextarea() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
}

function onInput(e: Event) {
  autoGrow(e.target as HTMLTextAreaElement)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return
  if (e.isComposing || (e as any).keyCode === 229) return
  e.preventDefault()
  submit()
}

function isNearBottom(margin = 260): boolean {
  if (typeof window === 'undefined') return true
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - margin
}

function scheduleAutoScroll(force = false) {
  if (typeof window === 'undefined') return
  if (!force && !isNearBottom()) return
  if (scrollRaf) return
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = 0
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' })
  })
}

function scrollToBottom() {
  if (typeof window === 'undefined') return
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' })
}

function submit() {
  const q = input.value.trim()
  if (!q) return
  void ask(q)
}

async function ask(raw: string) {
  const q = String(raw ?? '').trim()
  if (!q) return

  if (!corpus.value) {
    try {
      await ensureCorpus()
    } catch {
      /* corpusError 已给出提示；下面仍会生成一条含错误的助手消息 */
    }
  }

  abortActive()

  const userMsg = reactive<ChatMessage>({ id: ++uid, role: 'user', content: q, state: 'done' })
  const msg = reactive<ChatMessage>({
    id: ++uid,
    role: 'assistant',
    content: '',
    state: 'thinking',
  })
  messages.value.push(userMsg, msg)
  input.value = ''
  resetTextarea()

  if (!corpus.value) {
    msg.state = 'fallback'
    msg.error = corpusError.value || '本地索引不可用'
    msg.notice = corpusError.value || '本地索引不可用，暂时无法检索。'
    await nextTick()
    scrollToBottom()
    return
  }

  const plan = analyzeQuery(q)
  const result = retrieve(plan, corpus.value)
  const contextHits = result.all.slice(0, 8)

  msg.question = q
  msg.plan = plan
  msg.hits = result
  msg.contextHits = contextHits
  msg.citations = citationsFromHits(contextHits)
  msg.state = 'ready'

  await nextTick()
  scrollToBottom()

  if (!result.all.length) {
    msg.state = 'done'
    msg.notice = `没有在站内语料中找到「${q}」的相关条目。试试更短的关键词（如「月」「送别」），或用拼音 / 首字母（如 libai、lb）。`
    return
  }

  // 已明确未连接：不重复请求，直接给出降级提示
  if (conn.state === 'fail') {
    degrade(msg, 'no-model', conn.error)
    return
  }

  // 首次使用默认不静默探测本机；用户成功检测过一次后，刷新才自动探测
  if (conn.state !== 'ok') {
    if (!config.enabled) {
      degrade(
        msg,
        'no-model',
        '尚未检测本机 Ollama；如需生成式回答，请在「检索设置」中点击「检测连接」。',
      )
      return
    }
    msg.notice = '正在检测本机 Ollama（仅访问回环地址）…'
    const ok = await checkConnection({ silent: true, timeoutMs: 4500 })
    msg.notice = ''
    if (!ok) {
      degrade(msg, 'no-model', conn.error)
      return
    }
  }
  if (!conn.models.length) {
    degrade(msg, 'no-model', `Ollama 已连接，但尚未安装模型；请先执行 ollama pull ${config.model || DEFAULT_MODEL}`)
    return
  }

  await generate(msg)
}

function degrade(msg: ChatMessage, kind: 'no-model' | 'failure', reason: string) {
  msg.degraded = true
  if (kind === 'failure') {
    msg.state = 'fallback'
    msg.error = reason
    msg.notice = `生成式回答失败，已降级为仅检索结果。原因：${reason}`
  } else {
    msg.state = 'done'
    msg.notice = reason
      ? `未连接 Ollama，本次仅展示本地检索结果。原因：${reason}`
      : '未连接 Ollama，本次仅展示本地检索结果。'
  }
  if (msg.plan?.needsSynthesis) {
    msg.notice += ' 该问题需要模型综合对比；连接本机 Ollama 后点「重新生成」即可。'
  }
}

function conversationHistory(msg: ChatMessage): ChatDeltaMessage[] {
  const idx = messages.value.indexOf(msg)
  if (idx <= 0) return []
  const prior = messages.value
    .slice(0, idx)
    .filter((m) => m.content.trim())
    .slice(-4)
  return prior.map((m) => ({
    role: m.role,
    content: m.content.length > 700 ? `${m.content.slice(0, 700)}…` : m.content,
  }))
}

async function generate(msg: ChatMessage) {
  if (!msg.question || !msg.contextHits?.length || msg.streaming) return

  abortActive()

  const ctrl = new AbortController()
  activeAbort = ctrl
  activeMsg = msg
  msg.state = 'generating'
  msg.streaming = true
  msg.content = ''
  msg.notice = ''
  msg.error = ''
  msg.degraded = false

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, 180000)

  const payload: ChatDeltaMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory(msg),
    { role: 'user', content: buildUserPrompt(msg.question, msg.contextHits) },
  ]

  try {
    const answer = await streamOllamaChat({
      base: config.base,
      model: config.model,
      messages: payload,
      signal: ctrl.signal,
      onDelta: (piece) => {
        msg.content += piece
        scheduleAutoScroll()
      },
    })
    msg.content = answer
    msg.state = 'done'
    if (!answer.trim()) throw new Error('模型返回为空')
  } catch (err: any) {
    if (ctrl.signal.aborted) {
      if (timedOut) {
        msg.state = 'fallback'
        msg.degraded = true
        msg.error = '生成超时'
        msg.notice = '生成超时（180 秒），已降级为仅检索结果。'
      } else {
        msg.state = 'stopped'
        msg.notice = msg.content ? '已停止生成；以上为已生成的部分。' : '已停止生成。'
      }
    } else {
      const reason = describeOllamaError(err)
      degrade(msg, 'failure', reason)
    }
  } finally {
    clearTimeout(timer)
    msg.streaming = false
    if (activeMsg === msg) {
      activeAbort = null
      activeMsg = null
    }
    scheduleAutoScroll(true)
  }
}

function abortActive() {
  if (!activeAbort) return
  const msg = activeMsg
  activeAbort.abort()
  if (msg) {
    msg.streaming = false
    msg.state = 'stopped'
    if (!msg.notice) msg.notice = msg.content ? '已停止生成；以上为已生成的部分。' : '已停止生成。'
  }
  activeAbort = null
  activeMsg = null
}

async function regenerate(msg: ChatMessage) {
  if (msg.streaming) return
  if (conn.state !== 'ok') {
    if (!config.enabled) {
      degrade(
        msg,
        'no-model',
        '尚未检测本机 Ollama；请先在「检索设置」中点击「检测连接」，再重新生成。',
      )
      return
    }
    msg.notice = '正在检测本机 Ollama（仅访问回环地址）…'
    const ok = await checkConnection({ silent: true, timeoutMs: 4500 })
    msg.notice = ''
    if (!ok) {
      degrade(msg, 'no-model', conn.error)
      return
    }
  }
  if (!conn.models.length) {
    degrade(msg, 'no-model', `Ollama 已连接，但尚未安装模型；请先执行 ollama pull ${config.model || DEFAULT_MODEL}`)
    return
  }
  await generate(msg)
}

function clearChat() {
  abortActive()
  messages.value = []
  input.value = ''
  resetTextarea()
  nextTick(() => textarea.value?.focus())
}

/* ------------------------------------------------------------------ */
/* 展示辅助                                                            */
/* ------------------------------------------------------------------ */

function modeLabel(msg: ChatMessage): string {
  if (msg.streaming) return '本机模型 · 生成中'
  if (msg.state === 'stopped') return '已停止'
  if (msg.state === 'fallback') return '已降级'
  if (msg.content) return '本机模型'
  return '本地检索'
}

function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/** 纯文本安全渲染：转义后把 [1] 变成小胶囊，换行保留 */
function renderAnswer(text: string): string {
  return escapeHtml(text)
    .replace(/\[(\d{1,2})\]/g, '<span class="wj-ask-refnum">$1</span>')
    .replace(/\n/g, '<br>')
}

function resultCount(msg: ChatMessage): number {
  const h = msg.hits
  if (!h) return 0
  return h.totals.lines + h.totals.quotes + h.totals.entries
}

function chooseModel(name: string) {
  config.model = name
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

onMounted(async () => {
  loadSavedConfig()
  configReady.value = true

  try {
    await ensureCorpus()
  } catch {
    /* corpusError 已记录 */
  }

  // 支持 /ask/?q=... 直达问题（不写入历史，不改变配置）
  try {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q && corpus.value) {
      input.value = q
      await ask(q)
    }
  } catch {
    /* ignore */
  }
})

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (scrollRaf && typeof window !== 'undefined') window.cancelAnimationFrame(scrollRaf)
  abortActive()
})
</script>

<template>
  <div class="wj-ask-page">
    <section class="wj-ask" aria-labelledby="wj-ask-title">
      <header class="wj-ask-hero">
        <div class="wj-ask-heading">
          <p class="wj-ask-kicker">ASK · 问书库</p>
          <h1 id="wj-ask-title" class="wj-ask-title">问书库</h1>
          <p class="wj-ask-lead">
            基于站内语料的检索增强问答：先在本地检索，再按需交给本机模型组织答案。没有模型也能查。
          </p>
        </div>
        <div class="wj-ask-hero-actions">
          <button
            type="button"
            class="wj-ask-btn"
            :aria-expanded="settingsOpen"
            aria-controls="wj-ask-settings"
            @click="settingsOpen = !settingsOpen"
          >
            <span class="wj-ask-conn-dot" :data-state="conn.state" aria-hidden="true"></span>
            {{ settingsOpen ? '收起设置' : '检索设置' }}
          </button>
          <button type="button" class="wj-ask-btn" :disabled="!messages.length" @click="clearChat">
            清空对话
          </button>
        </div>
      </header>

      <section v-show="settingsOpen" id="wj-ask-settings" class="wj-ask-settings" aria-label="检索与模型设置">
        <div class="wj-ask-settings-head">
          <div>
            <p class="wj-ask-settings-kicker">LOCAL MODEL · 可选</p>
            <h2 class="wj-ask-settings-title">连接本机 Ollama</h2>
          </div>
          <span class="wj-ask-conn-short" :data-state="conn.state">
            <span class="wj-ask-conn-dot" :data-state="conn.state" aria-hidden="true"></span>
            {{ connShort }}
          </span>
        </div>

        <div class="wj-ask-fields">
          <label class="wj-ask-field">
            <span class="wj-ask-field-label">Ollama 地址</span>
            <input
              v-model="config.base"
              class="wj-ask-input"
              :class="{ 'is-invalid': showBaseError }"
              type="url"
              inputmode="url"
              spellcheck="false"
              autocomplete="off"
              placeholder="http://localhost:11434"
              @blur="baseTouched = true"
            />
            <small v-if="showBaseError" class="wj-ask-field-error">{{ baseError }}</small>
            <small v-else class="wj-ask-field-hint">默认 http://localhost:11434；仅允许本机回环地址。</small>
          </label>

          <label class="wj-ask-field">
            <span class="wj-ask-field-label">模型名</span>
            <input
              v-model="config.model"
              class="wj-ask-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              list="wj-ask-model-list"
              placeholder="qwen2.5:7b"
            />
            <datalist id="wj-ask-model-list">
              <option v-for="m in conn.models" :key="m" :value="m"></option>
            </datalist>
            <small class="wj-ask-field-hint">可填写本机已 pull 的任意模型，如 qwen2.5:7b。</small>
          </label>
        </div>

        <div class="wj-ask-settings-actions">
          <button
            type="button"
            class="wj-ask-btn is-primary"
            :disabled="conn.state === 'checking'"
            @click="checkConnection()"
          >
            <span v-if="conn.state === 'checking'" class="wj-ask-spin" aria-hidden="true"></span>
            {{ conn.state === 'checking' ? '检测中…' : '检测连接' }}
          </button>
          <span class="wj-ask-save-note">配置自动保存在本浏览器（localStorage）</span>
        </div>

        <div class="wj-ask-status" :data-state="conn.state" aria-live="polite">
          <template v-if="conn.state === 'idle'">未检测；生成式回答需要本机 Ollama，本地检索不受影响。</template>
          <template v-else-if="conn.state === 'checking'">
            正在连接 {{ normalizeOllamaBase(config.base) }} …
          </template>
          <template v-else-if="conn.state === 'ok'">
            <span class="wj-ask-status-main">已连接，可用模型：</span>
            <span v-if="conn.models.length" class="wj-ask-models">
              <button
                v-for="m in conn.models.slice(0, 10)"
                :key="m"
                type="button"
                class="wj-ask-model-pill"
                :class="{ active: m === config.model }"
                @click="chooseModel(m)"
              >
                {{ m }}
              </button>
              <span v-if="conn.models.length > 10" class="wj-ask-model-more">等 {{ conn.models.length }} 个</span>
            </span>
            <span v-else class="wj-ask-status-main">（尚未安装模型）</span>
            <span
              v-if="conn.models.length && !conn.models.includes(config.model)"
              class="wj-ask-status-warn"
            >
              当前填写的「{{ config.model }}」不在列表中，请确认已 ollama pull。
            </span>
          </template>
          <template v-else>
            <span class="wj-ask-status-main">未连接（可只用本地检索）</span>
            <span v-if="conn.error" class="wj-ask-status-detail">{{ conn.error }}</span>
          </template>
          <span v-if="mixedContent" class="wj-ask-status-warn">
            当前站点为 HTTPS，浏览器可能拦截对 http://localhost 的请求；请改用本地预览或 HTTPS 代理。
          </span>
        </div>

        <p class="wj-ask-settings-privacy">
          配置只保存在本浏览器，不会上传；不内置任何 API Key。仅当你连接成功并提问时，问题与 Top 8 检索片段才会发送到该本机服务。
        </p>
      </section>

      <p v-if="corpusError" class="wj-ask-load-error">{{ corpusError }}</p>

      <section v-if="!messages.length" class="wj-ask-empty" aria-label="示例问题">
        <div class="wj-ask-empty-seal" aria-hidden="true">问</div>
        <h2 class="wj-ask-empty-title">从站内语料里找答案</h2>
        <p class="wj-ask-empty-text">
          输入问题后，先检索作品、成语、名句、作者与意象；连接本机 Ollama 后，再将 Top 8 片段交给模型组织回答。
        </p>

        <div class="wj-ask-examples">
          <span class="wj-ask-examples-label">试试</span>
          <button
            v-for="ex in EXAMPLES"
            :key="ex.q"
            type="button"
            class="wj-ask-example"
            @click="ask(ex.q)"
          >
            {{ ex.label }}
            <small v-if="ex.needsModel">需模型</small>
          </button>
        </div>

        <ul class="wj-ask-abilities">
          <li><b>找作品</b><span>「李白的送别诗有哪些」</span></li>
          <li><b>找名句</b><span>「含月的思乡名句」</span></li>
          <li><b>找成语</b><span>「形容坚持的成语」</span></li>
          <li><b>比较分析</b><span>「苏轼和辛弃疾的词风差异」——需本机模型</span></li>
        </ul>

        <p v-if="corpusLoading" class="wj-ask-note">正在载入本地索引…</p>
        <p v-else-if="corpusStats" class="wj-ask-note">{{ corpusStats }}</p>
      </section>

      <section class="wj-ask-thread" aria-label="对话">
        <template v-for="m in messages" :key="m.id">
          <article v-if="m.role === 'user'" class="wj-ask-msg is-user">
            <div class="wj-ask-bubble">
              <p class="wj-ask-who">你</p>
              <p class="wj-ask-user-text">{{ m.content }}</p>
            </div>
          </article>

          <article v-else class="wj-ask-msg is-bot">
            <div class="wj-ask-bubble">
              <div class="wj-ask-bubble-head">
                <p class="wj-ask-who">书库</p>
                <span class="wj-ask-mode" :data-mode="m.state">{{ modeLabel(m) }}</span>
                <span v-if="m.streaming" class="wj-ask-live">生成中…</span>
              </div>

              <div v-if="m.state === 'thinking'" class="wj-ask-thinking">
                <span class="wj-ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                正在检索本地语料…
              </div>
              <div v-else-if="m.content" class="wj-ask-answer" v-html="renderAnswer(m.content)"></div>
              <div v-else-if="m.state === 'generating'" class="wj-ask-thinking">
                <span class="wj-ask-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                正在请求本机 Ollama…
              </div>
              <p v-if="m.streaming && m.content" class="wj-ask-caret" aria-hidden="true"></p>

              <p v-if="m.notice" class="wj-ask-notice" :class="{ 'is-error': m.state === 'fallback' }">
                {{ m.notice }}
              </p>

              <section
                v-if="m.citations?.length && m.content"
                class="wj-ask-cites"
                aria-label="引用出处"
              >
                <h3 class="wj-ask-section-title">引用出处</h3>
                <ol class="wj-ask-cite-list">
                  <li v-for="c in m.citations" :key="c.n" class="wj-ask-cite">
                    <span class="wj-ask-refnum">{{ c.n }}</span>
                    <a :href="c.route" class="wj-ask-cite-link">
                      <span class="wj-ask-cite-title">
                        {{ c.title }}
                        <span v-if="c.author" class="wj-ask-cite-author">· {{ c.author }}</span>
                      </span>
                      <span class="wj-ask-cite-snippet">{{ c.kicker }}：{{ c.snippet }}</span>
                    </a>
                  </li>
                </ol>
              </section>

              <section v-if="m.hits" class="wj-ask-results" aria-label="本地检索结果">
                <div class="wj-ask-results-head">
                  <h3 class="wj-ask-section-title">本地检索命中</h3>
                  <span class="wj-ask-results-count">共 {{ resultCount(m) }} 条</span>
                  <span v-if="m.contextHits?.length" class="wj-ask-results-note">
                    Top {{ m.contextHits.length }} 已整理为生成资料
                  </span>
                </div>

                <div class="wj-ask-groups">
                  <section v-if="m.hits.lines.length" class="wj-ask-group">
                    <h4 class="wj-ask-group-title">
                      诗句命中 <b>{{ m.hits.totals.lines }}</b>
                    </h4>
                    <ul class="wj-ask-hit-list">
                      <li v-for="hit in m.hits.lines" :key="hit.key" class="wj-ask-hit">
                        <a :href="hit.route" class="wj-ask-hit-link">
                          <span class="wj-ask-hit-primary">{{ hit.primary }}</span>
                          <span class="wj-ask-hit-secondary">{{ hit.secondary }}</span>
                          <span class="wj-ask-hit-why">{{ hit.matched }}</span>
                        </a>
                        <span class="wj-ask-hit-side">
                          <span v-if="hit.ref" class="wj-ask-refnum" :title="`作为资料 [${hit.ref}]`">{{ hit.ref }}</span>
                          <span class="wj-ask-score" :title="`相关度 ${hit.score}`">{{ relevancePercent(hit.score) }}%</span>
                        </span>
                      </li>
                    </ul>
                  </section>

                  <section v-if="m.hits.quotes.length" class="wj-ask-group">
                    <h4 class="wj-ask-group-title">
                      名句命中 <b>{{ m.hits.totals.quotes }}</b>
                    </h4>
                    <ul class="wj-ask-hit-list">
                      <li v-for="hit in m.hits.quotes" :key="hit.key" class="wj-ask-hit">
                        <a :href="hit.route" class="wj-ask-hit-link">
                          <span class="wj-ask-hit-primary">{{ hit.primary }}</span>
                          <span class="wj-ask-hit-secondary">{{ hit.secondary }}</span>
                          <span class="wj-ask-hit-why">{{ hit.matched }}</span>
                        </a>
                        <span class="wj-ask-hit-side">
                          <span v-if="hit.ref" class="wj-ask-refnum" :title="`作为资料 [${hit.ref}]`">{{ hit.ref }}</span>
                          <span class="wj-ask-score" :title="`相关度 ${hit.score}`">{{ relevancePercent(hit.score) }}%</span>
                        </span>
                      </li>
                    </ul>
                  </section>

                  <section v-if="m.hits.entries.length" class="wj-ask-group">
                    <h4 class="wj-ask-group-title">
                      条目命中 <b>{{ m.hits.totals.entries }}</b>
                    </h4>
                    <ul class="wj-ask-hit-list">
                      <li v-for="hit in m.hits.entries" :key="hit.key" class="wj-ask-hit">
                        <a :href="hit.route" class="wj-ask-hit-link">
                          <span class="wj-ask-hit-primary">
                            <span v-if="hit.type" class="wj-ask-type">{{ TYPE_ROUTE_LABEL[hit.type] }}</span>
                            {{ hit.primary }}
                          </span>
                          <span class="wj-ask-hit-secondary">{{ hit.secondary }}</span>
                          <span class="wj-ask-hit-why">{{ hit.matched }}</span>
                        </a>
                        <span class="wj-ask-hit-side">
                          <span v-if="hit.ref" class="wj-ask-refnum" :title="`作为资料 [${hit.ref}]`">{{ hit.ref }}</span>
                          <span class="wj-ask-score" :title="`相关度 ${hit.score}`">{{ relevancePercent(hit.score) }}%</span>
                        </span>
                      </li>
                    </ul>
                  </section>
                </div>

                <p
                  v-if="!m.hits.lines.length && !m.hits.quotes.length && !m.hits.entries.length"
                  class="wj-ask-note"
                >
                  没有检索到相关条目。试试更短的关键词，或用拼音 / 首字母。
                </p>
              </section>

              <div class="wj-ask-msg-actions">
                <button
                  v-if="m.streaming"
                  type="button"
                  class="wj-ask-linkbtn"
                  @click="abortActive"
                >
                  停止生成
                </button>
                <button
                  v-else-if="m.contextHits?.length"
                  type="button"
                  class="wj-ask-linkbtn"
                  @click="regenerate(m)"
                >
                  重新生成
                </button>
                <span v-if="m.hits" class="wj-ask-msg-meta">
                  {{ m.hits.totals.lines }} 诗句 · {{ m.hits.totals.quotes }} 名句 · {{ m.hits.totals.entries }} 条目
                </span>
              </div>
            </div>
          </article>
        </template>
      </section>

      <footer class="wj-ask-privacy">
        <span class="wj-ask-privacy-seal">本地</span>
        <span>
          检索全在本地完成；只有当你配置并连接本机 Ollama 时，问题与检索片段才会发送给该本机服务。本站不内置 API Key，不请求任何第三方网络。
        </span>
      </footer>
    </section>

    <div class="wj-ask-composer">
      <div class="wj-ask-composer-inner">
        <textarea
          ref="textarea"
          v-model="input"
          class="wj-ask-textarea"
          rows="1"
          spellcheck="false"
          placeholder="问书库：如「含月的思乡名句」「形容坚持的成语」…"
          aria-label="输入问题"
          @input="onInput"
          @keydown="onKeydown"
        ></textarea>
        <button v-if="busy" type="button" class="wj-ask-stop" @click="abortActive">停止</button>
        <button
          type="button"
          class="wj-ask-send"
          :disabled="!input.trim()"
          aria-label="发送问题"
          @click="submit"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 12h13M12 5l7 7-7 7"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      <div class="wj-ask-composer-meta">
        <span>Enter 发送 · Shift+Enter 换行</span>
        <span :data-state="conn.state">
          <span class="wj-ask-conn-dot" :data-state="conn.state" aria-hidden="true"></span>
          {{ composerHint }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wj-ask-page {
  box-sizing: border-box;
  width: 100%;
  padding-bottom: 180px;
}

.wj-ask {
  box-sizing: border-box;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 6px clamp(14px, 2.6vw, 30px) 26px;
}

/* ── 页头 ─────────────────────────────────────────────── */
.wj-ask-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 22px;
  padding: 4px 2px 10px;
  border-bottom: 2px solid var(--wj-border-strong);
}
.wj-ask-kicker {
  margin: 0 0 3px;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  letter-spacing: var(--wj-label-tracking);
  line-height: 1.3;
}
.wj-ask-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: clamp(30px, 4vw, 42px);
  font-weight: var(--wj-display-weight);
  letter-spacing: 0.06em;
  line-height: 1.16;
  color: var(--wj-ink);
}
.wj-ask-lead {
  margin: 6px 0 0;
  max-width: 620px;
  color: var(--wj-ink-2);
  font-size: 13.5px;
  line-height: 1.7;
}
.wj-ask-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: none;
  padding-bottom: 3px;
}

/* ── 通用按钮 / 输入 ──────────────────────────────────── */
.wj-ask-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 7px 15px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  transition: color 0.16s, border-color 0.16s, background 0.16s;
}
.wj-ask-btn:hover:not(:disabled) {
  color: var(--wj-ink);
  border-color: var(--wj-ink-3);
}
.wj-ask-btn.is-primary {
  background: var(--wj-accent);
  border-color: var(--wj-accent);
  color: var(--wj-card);
  font-weight: 700;
}
.wj-ask-btn.is-primary:hover:not(:disabled) {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
  color: var(--wj-card);
}
.wj-ask-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.wj-ask-input {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
  color: var(--wj-ink);
  font-family: var(--wj-font-body);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.wj-ask-input:focus {
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px var(--wj-accent-tint);
}
.wj-ask-input.is-invalid {
  border-color: var(--wj-accent);
}
.wj-ask-btn:focus-visible,
.wj-ask-input:focus-visible,
.wj-ask-textarea:focus-visible,
.wj-ask-example:focus-visible,
.wj-ask-model-pill:focus-visible,
.wj-ask-linkbtn:focus-visible,
.wj-ask-send:focus-visible,
.wj-ask-stop:focus-visible {
  outline: 2px solid var(--wj-accent);
  outline-offset: 2px;
}

/* ── 设置区 ───────────────────────────────────────────── */
.wj-ask-settings {
  margin: 16px 0 6px;
  padding: 16px 18px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}
.wj-ask-settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.wj-ask-settings-kicker {
  margin: 0 0 2px;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
  font-size: 9.5px;
  letter-spacing: var(--wj-label-tracking);
}
.wj-ask-settings-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 17px;
  font-weight: var(--wj-display-weight);
  letter-spacing: 0.04em;
  color: var(--wj-ink);
}
.wj-ask-conn-short {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 10px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-3);
  font-size: 11.5px;
  white-space: nowrap;
}
.wj-ask-conn-short[data-state='ok'] {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-ask-conn-short[data-state='fail'] {
  color: var(--wj-ink-3);
}
.wj-ask-conn-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--wj-line);
  border: 1px solid var(--wj-ink-3);
  flex: none;
}
.wj-ask-conn-dot[data-state='ok'] {
  background: var(--wj-accent);
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px var(--wj-accent-tint);
}
.wj-ask-conn-dot[data-state='checking'] {
  border-color: var(--wj-accent);
  animation: wj-ask-pulse 1s ease-in-out infinite;
}
.wj-ask-conn-dot[data-state='fail'] {
  background: transparent;
  border-color: var(--wj-ink-3);
}

.wj-ask-fields {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 14px;
  margin-top: 14px;
}
.wj-ask-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.wj-ask-field-label {
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.wj-ask-field-hint,
.wj-ask-field-error {
  font-size: 11.5px;
  line-height: 1.5;
}
.wj-ask-field-hint {
  color: var(--wj-ink-3);
}
.wj-ask-field-error {
  color: var(--wj-accent-deep);
}
.wj-ask-settings-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}
.wj-ask-save-note {
  color: var(--wj-ink-3);
  font-size: 11.5px;
}
.wj-ask-spin {
  width: 12px;
  height: 12px;
  border: 2px solid var(--wj-line);
  border-top-color: var(--wj-accent);
  border-radius: 50%;
  animation: wj-ask-spin 0.8s linear infinite;
  flex: none;
}
.wj-ask-status {
  margin-top: 13px;
  padding: 10px 12px;
  border: 1px solid var(--wj-line-soft);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
  color: var(--wj-ink-2);
  font-size: 12.5px;
  line-height: 1.7;
}
.wj-ask-status[data-state='ok'] {
  border-color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-ask-status[data-state='fail'] {
  border-style: dashed;
}
.wj-ask-status-main {
  color: var(--wj-ink);
}
.wj-ask-status-detail {
  display: block;
  margin-top: 2px;
  color: var(--wj-ink-3);
  font-size: 12px;
}
.wj-ask-status-warn {
  display: block;
  margin-top: 4px;
  color: var(--wj-accent-deep);
  font-size: 12px;
}
.wj-ask-models {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 5px;
  vertical-align: middle;
}
.wj-ask-model-pill {
  padding: 2px 9px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-mono);
  font-size: 11px;
  cursor: pointer;
}
.wj-ask-model-pill:hover {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
}
.wj-ask-model-pill.active {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-card);
  font-weight: 700;
}
.wj-ask-model-more {
  color: var(--wj-ink-3);
  font-size: 11.5px;
  align-self: center;
}
.wj-ask-settings-privacy {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px dashed var(--wj-line);
  color: var(--wj-ink-3);
  font-size: 11.5px;
  line-height: 1.6;
}
.wj-ask-load-error {
  margin: 14px 0;
  padding: 10px 12px;
  border-left: 3px solid var(--wj-accent);
  background: var(--wj-accent-tint);
  color: var(--wj-accent-deep);
  font-size: 13px;
  line-height: 1.6;
}

/* ── 空态 ─────────────────────────────────────────────── */
.wj-ask-empty {
  margin: 24px 0 8px;
  padding: 26px clamp(16px, 4vw, 38px);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  text-align: center;
}
.wj-ask-empty-seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  margin-bottom: 10px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 21px;
  line-height: 1;
}
.wj-ask-empty-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 21px;
  font-weight: var(--wj-display-weight);
  letter-spacing: 0.04em;
  color: var(--wj-ink);
}
.wj-ask-empty-text {
  max-width: 620px;
  margin: 7px auto 0;
  color: var(--wj-ink-2);
  font-size: 13.5px;
  line-height: 1.75;
}
.wj-ask-examples {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 18px 0 0;
}
.wj-ask-examples-label {
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
  font-size: 11px;
  letter-spacing: var(--wj-label-tracking);
}
.wj-ask-example {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 6px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-bg);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-body);
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s, transform 0.15s;
}
.wj-ask-example:hover {
  color: var(--wj-card);
  background: var(--wj-accent);
  border-color: var(--wj-accent);
  transform: translateY(-1px);
}
.wj-ask-example small {
  font-size: 9.5px;
  opacity: 0.68;
  letter-spacing: 0.04em;
}
.wj-ask-abilities {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 18px;
  max-width: 720px;
  margin: 18px auto 0;
  padding: 14px 0 0;
  border-top: 1px dashed var(--wj-line);
  list-style: none;
  text-align: left;
}
.wj-ask-abilities li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  color: var(--wj-ink-3);
  font-size: 12px;
  line-height: 1.6;
}
.wj-ask-abilities b {
  flex: none;
  padding: 1px 8px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  font-weight: 400;
  letter-spacing: 0.08em;
}
.wj-ask-abilities span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.wj-ask-note {
  margin: 14px 0 0;
  color: var(--wj-ink-3);
  font-size: 12px;
  line-height: 1.6;
}

/* ── 对话 ─────────────────────────────────────────────── */
.wj-ask-thread {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 22px 0 0;
}
.wj-ask-msg {
  display: flex;
  width: 100%;
}
.wj-ask-msg.is-user {
  justify-content: flex-end;
}
.wj-ask-msg.is-bot {
  justify-content: flex-start;
}
.wj-ask-bubble {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding: 16px 18px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}
.wj-ask-msg.is-user .wj-ask-bubble {
  width: auto;
  max-width: min(680px, 88%);
  background: var(--wj-accent);
  border-color: var(--wj-accent);
  color: var(--wj-card);
}
.wj-ask-who {
  margin: 0 0 6px;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  letter-spacing: var(--wj-label-tracking);
  line-height: 1.2;
}
.wj-ask-msg.is-user .wj-ask-who {
  color: var(--wj-card);
  opacity: 0.72;
}
.wj-ask-user-text {
  margin: 0;
  color: var(--wj-card);
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.wj-ask-bubble-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.wj-ask-bubble-head .wj-ask-who {
  margin: 0;
  color: var(--wj-ink);
  font-size: 11px;
}
.wj-ask-mode {
  padding: 1px 8px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-3);
  font-size: 10px;
  letter-spacing: 0.05em;
}
.wj-ask-mode[data-mode='generating'],
.wj-ask-mode[data-mode='done'] {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-ask-mode[data-mode='fallback'] {
  border-style: dashed;
  color: var(--wj-accent-deep);
}
.wj-ask-live {
  color: var(--wj-ink-3);
  font-size: 10.5px;
}
.wj-ask-answer {
  color: var(--wj-ink);
  font-size: 14.5px;
  line-height: 1.9;
  word-break: break-word;
}
.wj-ask-answer :deep(.wj-ask-refnum) {
  margin: 0 2px;
  vertical-align: 1px;
}
.wj-ask-caret {
  display: inline-block;
  width: 7px;
  height: 15px;
  margin: 2px 0 0 2px;
  background: var(--wj-accent);
  animation: wj-ask-blink 1s steps(2, start) infinite;
}
.wj-ask-thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--wj-ink-3);
  font-size: 13px;
  line-height: 1.7;
}
.wj-ask-dots {
  display: inline-flex;
  gap: 3px;
}
.wj-ask-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--wj-accent);
  animation: wj-ask-bounce 1s ease-in-out infinite;
}
.wj-ask-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.wj-ask-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
.wj-ask-notice {
  margin: 12px 0 0;
  padding: 9px 11px;
  border-left: 3px solid var(--wj-accent);
  background: var(--wj-accent-tint);
  color: var(--wj-ink-2);
  font-size: 12.5px;
  line-height: 1.65;
}
.wj-ask-notice.is-error {
  border-left-style: dashed;
  color: var(--wj-ink);
}

/* ── 引用列表 ─────────────────────────────────────────── */
.wj-ask-section-title {
  margin: 0;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  font-weight: 400;
  letter-spacing: var(--wj-label-tracking);
  line-height: 1.4;
}
.wj-ask-cites {
  margin-top: 16px;
  padding-top: 13px;
  border-top: 1px solid var(--wj-line-soft);
}
.wj-ask-cite-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 20px;
  margin: 9px 0 0;
  padding: 0;
  list-style: none;
}
.wj-ask-cite {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  min-width: 0;
  padding: 4px 0;
}
.wj-ask-cite-link {
  min-width: 0;
  color: var(--wj-ink-2);
  text-decoration: none;
}
.wj-ask-cite-link:hover .wj-ask-cite-title {
  color: var(--wj-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.wj-ask-cite-title {
  display: block;
  color: var(--wj-ink);
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.5;
  transition: color 0.15s;
}
.wj-ask-cite-author {
  color: var(--wj-ink-3);
  font-weight: 400;
}
.wj-ask-cite-snippet {
  display: block;
  overflow: hidden;
  color: var(--wj-ink-3);
  font-size: 11.5px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 检索结果分组 ─────────────────────────────────────── */
.wj-ask-results {
  margin-top: 16px;
  padding-top: 13px;
  border-top: 1px solid var(--wj-line-soft);
}
.wj-ask-results-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.wj-ask-results-count {
  color: var(--wj-ink-2);
  font-size: 12px;
}
.wj-ask-results-note {
  margin-left: auto;
  color: var(--wj-ink-3);
  font-size: 11px;
}
.wj-ask-groups {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 10px;
}
.wj-ask-group {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--wj-line-soft);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
}
.wj-ask-group-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 4px;
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 11.5px;
  font-weight: 400;
  letter-spacing: 0.06em;
}
.wj-ask-group-title b {
  color: var(--wj-accent);
  font-size: 11px;
  font-weight: 400;
}
.wj-ask-hit-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.wj-ask-hit {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  padding: 7px 0;
  border-bottom: 1px dashed var(--wj-line-soft);
}
.wj-ask-hit:last-child {
  border-bottom: 0;
  padding-bottom: 2px;
}
.wj-ask-hit-link {
  display: block;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
.wj-ask-hit-primary {
  display: block;
  color: var(--wj-ink);
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
}
.wj-ask-hit-link:hover .wj-ask-hit-primary {
  color: var(--wj-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.wj-ask-hit-secondary {
  display: block;
  overflow: hidden;
  margin-top: 2px;
  color: var(--wj-ink-3);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wj-ask-hit-why {
  display: block;
  margin-top: 2px;
  color: var(--wj-ink-3);
  font-size: 10px;
  line-height: 1.4;
  opacity: 0.8;
}
.wj-ask-hit-side {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.wj-ask-score {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  padding: 1px 5px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-3);
  font-size: 9.5px;
  line-height: 1.5;
  white-space: nowrap;
}
.wj-ask-type {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
  font-size: 9.5px;
  line-height: 1.5;
  vertical-align: 1px;
}
.wj-ask-refnum {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--wj-radius-pill);
  background: var(--wj-accent);
  color: var(--wj-card);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  flex: none;
}

/* ── 消息底部操作 ─────────────────────────────────────── */
.wj-ask-msg-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 13px;
  padding-top: 9px;
  border-top: 1px solid var(--wj-line-soft);
}
.wj-ask-linkbtn {
  padding: 0;
  border: 0;
  background: none;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.wj-ask-linkbtn:hover {
  color: var(--wj-accent-deep);
}
.wj-ask-msg-meta {
  margin-left: auto;
  color: var(--wj-ink-3);
  font-size: 10.5px;
}

/* ── 隐私页脚 ─────────────────────────────────────────── */
.wj-ask-privacy {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 24px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--wj-line);
  color: var(--wj-ink-3);
  font-size: 11.5px;
  line-height: 1.7;
}
.wj-ask-privacy-seal {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 9.5px;
  letter-spacing: 0.1em;
}

/* ── 底部固定输入条 ───────────────────────────────────── */
.wj-ask-composer {
  position: fixed;
  left: 50%;
  bottom: 12px;
  z-index: 30;
  box-sizing: border-box;
  width: min(1120px, calc(100% - 32px));
  margin: 0;
  padding: 10px 12px 8px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  transform: translateX(-50%);
}
.wj-ask-composer-inner {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.wj-ask-textarea {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  max-height: 140px;
  padding: 9px 12px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg);
  color: var(--wj-ink);
  font-family: var(--wj-font-body);
  font-size: 15px;
  line-height: 1.55;
  resize: none;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.wj-ask-textarea:focus {
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px var(--wj-accent-tint);
}
.wj-ask-textarea::placeholder {
  color: var(--wj-ink-3);
}
.wj-ask-send,
.wj-ask-stop {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wj-radius-pill);
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
.wj-ask-send {
  width: 40px;
  height: 40px;
  border: 0;
  background: var(--wj-accent);
  color: var(--wj-card);
}
.wj-ask-send:hover:not(:disabled) {
  background: var(--wj-accent-deep);
}
.wj-ask-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wj-ask-stop {
  height: 40px;
  padding: 0 13px;
  border: 1px solid var(--wj-line);
  background: var(--wj-bg);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 12px;
}
.wj-ask-stop:hover {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
}
.wj-ask-composer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 4px 0;
  color: var(--wj-ink-3);
  font-size: 10.5px;
  line-height: 1.4;
}
.wj-ask-composer-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wj-ask-composer-meta span:last-child[data-state='ok'] {
  color: var(--wj-accent);
}

/* ── 动画 ─────────────────────────────────────────────── */
@keyframes wj-ask-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes wj-ask-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
@keyframes wj-ask-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
@keyframes wj-ask-blink {
  50% {
    opacity: 0;
  }
}

/* ── 主题细节 ─────────────────────────────────────────── */
:global([data-theme='editorial'] .wj-ask-settings) {
  border-top: 2px solid var(--wj-border-strong);
}
:global([data-theme='editorial'] .wj-ask-group-title) {
  text-transform: uppercase;
  letter-spacing: 0.16em;
}
:global([data-theme='ink'] .wj-ask-title) {
  letter-spacing: 0.18em;
}
:global([data-theme='ink'] .wj-ask-hit-primary) {
  font-family: var(--wj-font-poem);
}
:global([data-theme='youth'] .wj-ask-bubble),
:global([data-theme='youth'] .wj-ask-settings),
:global([data-theme='youth'] .wj-ask-empty) {
  box-shadow: var(--wj-shadow);
}
:global([data-theme='youth'] .wj-ask-example:hover) {
  color: var(--wj-card);
}

/* ── 响应式 ───────────────────────────────────────────── */
@media (max-width: 900px) {
  .wj-ask-groups {
    grid-template-columns: 1fr;
  }
  .wj-ask-cite-list {
    grid-template-columns: 1fr;
  }
  .wj-ask-fields {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .wj-ask-hero {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .wj-ask-hero-actions {
    width: 100%;
  }
  .wj-ask-empty {
    padding: 20px 14px;
  }
  .wj-ask-abilities {
    grid-template-columns: 1fr;
  }
  .wj-ask-msg.is-user .wj-ask-bubble {
    max-width: 94%;
  }
  .wj-ask-results-note {
    margin-left: 0;
  }
  .wj-ask-msg-meta {
    margin-left: 0;
  }
  .wj-ask-page {
    padding-bottom: 220px;
  }
  .wj-ask-composer {
    bottom: calc(8px + env(safe-area-inset-bottom));
    width: calc(100% - 16px);
    padding: 8px 9px 6px;
  }
  .wj-ask-textarea {
    font-size: 16px;
  }
  .wj-ask-composer-meta span:last-child {
    display: none;
  }
  .wj-ask-privacy {
    align-items: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .wj-ask-btn,
  .wj-ask-example,
  .wj-ask-input,
  .wj-ask-textarea,
  .wj-ask-cite-title,
  .wj-ask-send {
    transition: none;
  }
  .wj-ask-conn-dot,
  .wj-ask-dots i,
  .wj-ask-caret,
  .wj-ask-spin {
    animation: none;
  }
  .wj-ask-example:hover {
    transform: none;
  }
}
</style>