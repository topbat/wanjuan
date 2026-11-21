<script setup lang="ts">
/**
 * 万卷 · 首页（三主题分支）
 * 数据源：/indexes/stats.json、/indexes/quotes.json（构建期产物）
 * 视觉规范：design-proposals/proposal-{1-ink,2-editorial,3-youth}.html 首页样张
 */
import { computed, onMounted, ref } from 'vue'
import { useWjTheme } from '../composables/useWjTheme'

const theme = useWjTheme()

const stats = ref<any>(null)
const quotes = ref<any[]>([])
const quoteIdx = ref(0)

onMounted(async () => {
  try {
    const base = import.meta.env.BASE_URL
    const [s, q] = await Promise.all([
      fetch(`${base}indexes/stats.json`).then((r) => r.json()),
      fetch(`${base}indexes/quotes.json`).then((r) => r.json()),
    ])
    stats.value = s
    quotes.value = q.items ?? []
    quoteIdx.value = new Date().getDate() % Math.max(1, quotes.value.length)
  } catch {
    /* 索引缺失时页面仍可浏览，数字显示 — */
  }
})

const totals = computed(() => stats.value?.totals ?? {})
const nodes = computed(() => stats.value?.totals ? (stats.value.totals.poems * 8) : null)
const byStage = computed(() => stats.value?.curriculum?.byStage ?? {})
const quote = computed(() => quotes.value[quoteIdx.value] ?? null)

const MODULES = [
  { no: '01', icon: '图', emoji: '🕸️', en: 'Graph', title: '知识图谱', desc: '作者、作品、意象、成语互联成网，点击节点邻域聚焦、一键回源。', link: 'explore/graph', metric: '节点' },
  { no: '02', icon: '云', emoji: '☁️', en: 'Cloud', title: '主题词云', desc: '构建期分词统计高频词，字号即词频，切换词频/意象/主题视角。', link: 'explore/wordcloud', metric: '词频' },
  { no: '03', icon: '统', emoji: '📊', en: 'Stats', title: '双轨统计', desc: '文学本体轨与课标轨并轨切片，矩形树图与旭日图双视图。', link: 'explore/stats', metric: '学段' },
  { no: '04', icon: '检', emoji: '🔍', en: 'Search', title: '高级检索', desc: '汉字、全拼、首字母三通道，输入 jys 直达《静夜思》。', link: 'explore/search', metric: '索引' },
]

const STAGES = [
  { id: 'primary', label: '小学', desc: '唐诗启蒙，朗朗上口', emoji: '🌱', grad: '#2fbfae' },
  { id: 'junior', label: '初中', desc: '词曲散文，意境渐深', emoji: '🚀', grad: '#7c5ce0' },
  { id: 'senior', label: '高中', desc: '古文诗词，兼及鉴赏', emoji: '🏆', grad: '#ff9b47' },
]

function go(path: string) {
  return import.meta.env.BASE_URL + path
}
</script>

<template>
  <div class="wj-home">
    <!-- ==================== 宣纸墨韵 ==================== -->
    <template v-if="theme === 'ink'">
      <div class="wj-h-ink hero">
        <div>
          <div class="eyebrow">中小学文学知识库</div>
          <h1>读书破<em>万卷</em>，<br />下笔如有神</h1>
          <p class="hero-sub">
            课本里的 <b>{{ totals.poems ?? '—' }} 篇</b>诗文、<b>{{ totals.idioms ?? '—' }} 条</b>成语、<b>{{ totals.quotes ?? '—' }} 则</b>名句，装进一座随身书房。本地
            Markdown，离线可读，检索如翻书。
          </p>
          <div class="stats-inline">
            <div class="stat"><small>课文</small><b>{{ totals.poems ?? '—' }}</b></div>
            <div class="stat"><small>成语</small><b>{{ totals.idioms ?? '—' }}</b></div>
            <div class="stat"><small>名句</small><b>{{ totals.quotes ?? '—' }}</b></div>
            <div class="stat"><small>作者</small><b>{{ totals.authors ?? '—' }}</b></div>
          </div>
        </div>
        <div class="title-tag">
          <span class="tt-text">万卷 · 中小学文学知识库</span>
          <div class="tt-side">
            <span class="tt-sub">读书破万卷</span>
            <span class="seal"><span>万卷</span></span>
          </div>
        </div>
      </div>

      <div class="wj-h-ink feat-grid">
        <a v-for="m in MODULES" :key="m.no" class="f-card" :href="go(m.link)">
          <div class="f-top"><span class="f-ico">{{ m.icon }}</span><span class="f-no">其{{ ['一', '二', '三', '四'][Number(m.no) - 1] }}</span></div>
          <h3>{{ m.title }}</h3>
          <p>{{ m.desc }}</p>
          <div class="f-data"><span>{{ m.metric }}</span><span class="go">入内 →</span></div>
        </a>
      </div>

      <div class="wj-h-ink stages">
        <a v-for="s in STAGES" :key="s.id" class="stage" :href="go('stage/' + s.id)">
          <div class="stage-ribbon">{{ s.label }}</div>
          <div class="stage-body">
            <div class="num">{{ byStage[s.label] ?? '—' }}<small>篇</small></div>
            <p>{{ s.desc }}</p>
            <span class="enter">入内 →</span>
          </div>
        </a>
      </div>

      <div v-if="quote" class="wj-h-ink quote-card">
        <svg class="brush" viewBox="0 0 260 20" fill="none" aria-hidden="true">
          <path d="M6 12 C 60 4, 120 18, 254 8" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" opacity=".9" />
          <path d="M14 16 C 80 12, 160 20, 236 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".45" />
        </svg>
        <blockquote>{{ quote.text }}</blockquote>
        <cite>—— {{ quote.author }}（{{ quote.dynasty }}）</cite>
        <span class="seal sm q-seal"><span>日课</span></span>
      </div>
    </template>

    <!-- ==================== 瑞士编辑部 ==================== -->
    <template v-else-if="theme === 'editorial'">
      <div class="wj-h-ed hero">
        <div>
          <div class="kicker">中小学文学知识库 — Literature Knowledge Base</div>
          <h1>读书破万卷，<br /><span class="hl">下笔如有神</span>。</h1>
          <p class="hero-sub">
            课本里的 <b>{{ totals.poems ?? '—' }}</b> 篇诗文、<b>{{ totals.idioms ?? '—' }}</b> 条成语、<b>{{ totals.quotes ?? '—' }}</b>
            则名句，以数据的方式组织：全局检索、知识图谱、标签统计。本地 Markdown，离线可用。
          </p>
        </div>
        <div class="hstats">
          <div class="hstat"><b>{{ totals.poems ?? '—' }}</b><span>课文<br />Entries</span></div>
          <div class="hstat"><b class="blue">{{ nodes ?? '—' }}</b><span>图谱节点<br />Nodes</span></div>
          <div class="hstat"><b>{{ totals.idioms ?? '—' }}</b><span>成语<br />Idioms</span></div>
          <div class="hstat"><b>{{ totals.quotes ?? '—' }}</b><span>名句<br />Quotes</span></div>
        </div>
      </div>

      <div class="wj-h-ed sec-head">
        <span class="sec-no">A — 01</span>
        <span class="sec-title">四件套</span>
        <span class="sec-en">Modules</span>
        <span class="sec-note">四个核心功能入口</span>
      </div>
      <div class="wj-h-ed mods">
        <a v-for="m in MODULES" :key="m.no" class="mod" :href="go(m.link)">
          <span class="mod-no">{{ m.no }}</span>
          <span class="mod-en">{{ m.en }}</span>
          <h3>{{ m.title }}</h3>
          <p>{{ m.desc }}</p>
          <div class="mod-go">Open →</div>
        </a>
      </div>

      <div class="wj-h-ed sec-head mt">
        <span class="sec-no">A — 02</span>
        <span class="sec-title">学段入口</span>
        <span class="sec-en">Stages</span>
        <span class="sec-note">课标对齐 · 按年级分组</span>
      </div>
      <div class="wj-h-ed stages">
        <a v-for="s in STAGES" :key="s.id" class="stage" :href="go('stage/' + s.id)">
          <div class="lab">Stage · {{ s.label }}</div>
          <div class="n">{{ byStage[s.label] ?? '—' }}<small>篇</small></div>
          <p>{{ s.desc }}</p>
        </a>
      </div>
      <div class="wj-h-ed sumline">
        <span>Total <b>{{ totals.poems ?? '—' }}</b> — 三学段合计</span>
        <span>数据源：本地 Markdown 内容库</span>
      </div>

      <div v-if="quote" class="wj-h-ed dq">
        <div>
          <div class="lab">Daily Quote — 今日一句</div>
          <blockquote>“{{ quote.text }}”</blockquote>
        </div>
        <cite>—— {{ quote.author }}（{{ quote.dynasty }}）</cite>
      </div>
    </template>

    <!-- ==================== 少年派 ==================== -->
    <template v-else>
      <div class="wj-h-y hero">
        <span class="hero-badge">🎉 已收录 <b>{{ totals.poems ?? '—' }}</b> 篇课文 · <b>{{ totals.idioms ?? '—' }}</b> 条成语 · <b>{{ totals.quotes ?? '—' }}</b> 则名句</span>
        <h1>读书破<span class="grad-text">万卷</span>，<br />下笔<span class="grad-text">如有神</span></h1>
        <p class="hero-sub">把课本里的诗词成语，变成每天十分钟的<b>闯关游戏</b>——搜一搜、连一连、背一背，攒起你的文学地图。</p>
        <div class="hero-btns">
          <a class="btn btn-primary" :href="go('explore/graph')">开始探索 ✨</a>
          <a class="btn btn-white" :href="go('explore/search')">搜一搜 🔍</a>
        </div>
      </div>

      <div class="wj-h-y sec-head">
        <span class="sec-emoji">🧭</span>
        <span class="sec-title">四大玩法</span>
        <span class="sec-sub">图谱 · 词云 · 统计 · 检索</span>
        <span class="sec-chip">全部离线可用</span>
      </div>
      <div class="wj-h-y feat-grid">
        <a v-for="m in MODULES" :key="m.no" class="f-card" :href="go(m.link)">
          <span class="f-ico" :class="'ico-' + m.no">{{ m.emoji }}</span>
          <h3>{{ m.title }}</h3>
          <p>{{ m.desc }}</p>
          <span class="f-link">去玩 →</span>
        </a>
      </div>

      <div class="wj-h-y sec-head">
        <span class="sec-emoji">🎒</span>
        <span class="sec-title">闯关地图</span>
        <span class="sec-sub">从小学出发，一路升到高中</span>
        <span class="sec-chip">合计 {{ totals.poems ?? '—' }} 篇</span>
      </div>
      <div class="wj-h-y stages">
        <a v-for="(s, i) in STAGES" :key="s.id" class="stage" :href="go('stage/' + s.id)">
          <div class="stage-top">
            <span class="stage-emoji">{{ s.emoji }}</span>
            <div>
              <div class="stage-name">{{ s.label }}</div>
              <div class="stage-desc">{{ s.desc }}</div>
            </div>
            <div class="stage-num"><b>{{ byStage[s.label] ?? '—' }}</b><small>篇</small></div>
          </div>
          <div class="stage-bar"><i :style="{ width: Math.round(((byStage[s.label] ?? 0) / Math.max(1, totals.poems ?? 1)) * 100) + '%', background: s.grad }"></i></div>
          <div class="stage-cap"><span>已收录 {{ byStage[s.label] ?? 0 }} 篇</span><span>{{ Math.round(((byStage[s.label] ?? 0) / Math.max(1, totals.poems ?? 1)) * 100) }}%</span></div>
        </a>
      </div>

      <div v-if="quote" class="wj-h-y quote-card">
        <span class="q-emoji">🌙</span>
        <div class="q-mid">
          <span class="q-label">今日一句</span>
          <blockquote>{{ quote.text }}</blockquote>
          <cite>—— {{ quote.author }}（{{ quote.dynasty }}）</cite>
        </div>
        <button class="q-btn" @click="quoteIdx = (quoteIdx + 1) % Math.max(1, quotes.length)">换一句 🎲</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wj-home {
  padding: 8px 0 40px;
}

/* ---------------- ink ---------------- */
.wj-h-ink .hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 56px;
  align-items: center;
  padding: 48px 0 36px;
}
.wj-h-ink .eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  letter-spacing: 0.3em;
  font-size: 14px;
}
.wj-h-ink .eyebrow::before {
  content: '';
  width: 8px;
  height: 8px;
  background: var(--wj-accent);
}
.wj-h-ink h1 {
  font-family: var(--wj-font-display);
  font-weight: 400;
  font-size: clamp(34px, 4.4vw, 50px);
  letter-spacing: 0.14em;
  line-height: 1.6;
  margin: 18px 0 14px;
  color: var(--wj-ink);
}
.wj-h-ink h1 em {
  font-style: normal;
  color: var(--wj-accent);
}
.wj-h-ink .hero-sub {
  color: var(--wj-ink-2);
  font-size: 15px;
  max-width: 580px;
}
.wj-h-ink .hero-sub b {
  font-weight: 600;
  color: var(--wj-ink);
}
.wj-h-ink .stats-inline {
  display: flex;
  gap: 34px;
  margin-top: 28px;
  flex-wrap: wrap;
}
.wj-h-ink .stat small {
  display: block;
  color: var(--wj-ink-3);
  font-size: 12px;
  letter-spacing: 0.16em;
}
.wj-h-ink .stat b {
  font-size: 22px;
  letter-spacing: 0.04em;
  color: var(--wj-ink);
}
.wj-h-ink .title-tag {
  height: 280px;
  border: 1px solid var(--wj-line);
  background: var(--wj-card);
  padding: 24px 18px;
  display: grid;
  grid-template-columns: auto auto;
  column-gap: 20px;
  justify-content: center;
  align-items: start;
}
.wj-h-ink .tt-text {
  writing-mode: vertical-rl;
  font-family: var(--wj-font-display);
  font-size: 19px;
  letter-spacing: 0.42em;
  color: var(--wj-ink);
}
.wj-h-ink .tt-sub {
  writing-mode: vertical-rl;
  font-family: var(--wj-font-display);
  font-size: 13px;
  letter-spacing: 0.4em;
  color: var(--wj-ink-3);
  padding-top: 14px;
}
.wj-h-ink .tt-side {
  display: grid;
  grid-template-rows: 1fr auto;
  justify-items: center;
  height: 100%;
}
.wj-h-ink .seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 5px;
  background: var(--wj-accent);
  color: #f6efdc;
  font-family: var(--wj-font-display);
  box-shadow: inset 0 0 0 2px rgba(246, 239, 220, 0.55), inset 0 0 0 4px var(--wj-accent), 0 2px 8px rgba(140, 50, 35, 0.28);
  transform: rotate(2deg);
  align-self: end;
}
.wj-h-ink .seal span {
  writing-mode: vertical-rl;
  font-size: 16px;
  letter-spacing: 0.18em;
  line-height: 1;
}
.wj-h-ink .seal.sm {
  width: 34px;
  height: 34px;
}
.wj-h-ink .seal.sm span {
  font-size: 12px;
}
.wj-h-ink .feat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
  margin-top: 32px;
}
.wj-h-ink .f-card {
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  padding: 22px 20px 18px;
  display: flex;
  flex-direction: column;
  transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
}
.wj-h-ink .f-card:hover {
  border-color: var(--wj-ink);
  transform: translateY(-3px);
  box-shadow: 0 12px 26px rgba(38, 35, 30, 0.08);
}
.wj-h-ink .f-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--wj-line-soft);
  padding-bottom: 14px;
}
.wj-h-ink .f-ico {
  width: 42px;
  height: 42px;
  border: 1px solid var(--wj-ink);
  display: grid;
  place-items: center;
  font-family: var(--wj-font-display);
  font-size: 19px;
  background: var(--wj-bg);
}
.wj-h-ink .f-no {
  font-size: 12px;
  color: var(--wj-ink-3);
  letter-spacing: 0.2em;
}
.wj-h-ink .f-card h3 {
  font-family: var(--wj-font-display);
  font-size: 19px;
  letter-spacing: 0.14em;
  font-weight: 400;
  margin: 12px 0 6px;
}
.wj-h-ink .f-card p {
  font-size: 13.5px;
  color: var(--wj-ink-2);
  line-height: 1.85;
  flex: 1;
}
.wj-h-ink .f-data {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--wj-ink-3);
  margin-top: 12px;
}
.wj-h-ink .f-data .go {
  color: var(--wj-accent);
}
.wj-h-ink .stages {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin-top: 20px;
}
.wj-h-ink .stage {
  display: grid;
  grid-template-columns: auto 1fr;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  transition: border-color 0.18s;
}
.wj-h-ink .stage:hover {
  border-color: var(--wj-ink);
}
.wj-h-ink .stage-ribbon {
  writing-mode: vertical-rl;
  font-family: var(--wj-font-display);
  font-size: 16px;
  letter-spacing: 0.5em;
  padding: 20px 13px;
  border-right: 1px solid var(--wj-line);
  color: var(--wj-ink-2);
  display: flex;
  align-items: center;
  transition: all 0.18s;
}
.wj-h-ink .stage:hover .stage-ribbon {
  background: var(--wj-accent);
  color: #f8f1e1;
  border-right-color: var(--wj-accent);
}
.wj-h-ink .stage-body {
  padding: 20px 22px;
}
.wj-h-ink .stage-body .num {
  font-size: 34px;
  letter-spacing: 0.02em;
  line-height: 1.2;
  color: var(--wj-ink);
}
.wj-h-ink .stage-body .num small {
  font-size: 14px;
  color: var(--wj-ink-3);
  margin-left: 6px;
}
.wj-h-ink .stage-body p {
  font-size: 13px;
  color: var(--wj-ink-2);
  margin-top: 4px;
}
.wj-h-ink .stage-body .enter {
  display: inline-block;
  margin-top: 12px;
  font-family: var(--wj-font-display);
  font-size: 13px;
  color: var(--wj-accent);
  letter-spacing: 0.25em;
}
.wj-h-ink .quote-card {
  position: relative;
  text-align: center;
  padding: 46px 100px;
  border-top: 1px solid var(--wj-line);
  border-bottom: 1px solid var(--wj-line);
  margin-top: 24px;
}
.wj-h-ink .brush {
  display: block;
  margin: 0 auto 4px;
  width: 260px;
  height: 20px;
  color: #332f27;
  opacity: 0.85;
}
.wj-h-ink .quote-card blockquote {
  font-family: var(--wj-font-display);
  font-size: 24px;
  letter-spacing: 0.2em;
  line-height: 2;
  color: var(--wj-ink);
}
.wj-h-ink .quote-card cite {
  display: block;
  font-style: normal;
  color: var(--wj-ink-3);
  font-size: 14px;
  letter-spacing: 0.24em;
  margin-top: 10px;
}
.wj-h-ink .q-seal {
  position: absolute;
  right: 30px;
  top: 50%;
  transform: translateY(-50%) rotate(3deg);
}

/* ---------------- editorial ---------------- */
.wj-h-ed .hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 52px;
  padding: 52px 0 40px;
  border-bottom: 1px solid var(--wj-border-strong);
}
.wj-h-ed .kicker {
  font-size: 11px;
  letter-spacing: var(--wj-label-tracking);
  color: var(--wj-ink-2);
  text-transform: uppercase;
  font-weight: 600;
}
.wj-h-ed h1 {
  font-size: clamp(38px, 4.8vw, 62px);
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.24;
  margin: 18px 0 20px;
  color: var(--wj-ink);
}
.wj-h-ed h1 .hl {
  text-decoration: underline;
  text-decoration-color: var(--wj-accent);
  text-decoration-thickness: 0.13em;
  text-underline-offset: 0.14em;
}
.wj-h-ed .hero-sub {
  font-size: 15px;
  color: var(--wj-ink-2);
  max-width: 56ch;
}
.wj-h-ed .hero-sub b {
  color: var(--wj-ink);
  font-weight: 700;
}
.wj-h-ed .hstats {
  border-left: 1px solid var(--wj-border-strong);
  padding-left: 34px;
}
.wj-h-ed .hstat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--wj-line);
}
.wj-h-ed .hstat:last-child {
  border-bottom: 0;
}
.wj-h-ed .hstat b {
  font-size: 33px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--wj-ink);
}
.wj-h-ed .hstat b.blue {
  color: var(--wj-accent);
}
.wj-h-ed .hstat span {
  font-size: 10.5px;
  letter-spacing: var(--wj-label-tracking);
  color: var(--wj-ink-2);
  text-transform: uppercase;
  text-align: right;
}
.wj-h-ed .sec-head {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin: 40px 0 22px;
  flex-wrap: wrap;
}
.wj-h-ed .sec-head.mt {
  margin-top: 48px;
}
.wj-h-ed .sec-no {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.26em;
  color: var(--wj-accent);
}
.wj-h-ed .sec-title {
  font-size: 22px;
  font-weight: 800;
}
.wj-h-ed .sec-en {
  font-size: 10.5px;
  letter-spacing: 0.3em;
  color: var(--wj-ink-2);
  text-transform: uppercase;
  font-weight: 600;
}
.wj-h-ed .sec-note {
  margin-left: auto;
  font-size: 12px;
  color: var(--wj-ink-2);
}
.wj-h-ed .mods {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--wj-border-strong);
  border: 1px solid var(--wj-border-strong);
}
.wj-h-ed .mod {
  background: var(--wj-card);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 230px;
  transition: box-shadow 0.15s;
}
.wj-h-ed .mod:hover {
  box-shadow: inset 0 0 0 2px var(--wj-accent);
}
.wj-h-ed .mod-no {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--wj-ink-3);
}
.wj-h-ed .mod-en {
  font-size: 10px;
  letter-spacing: 0.26em;
  color: var(--wj-ink-2);
  text-transform: uppercase;
  font-weight: 600;
}
.wj-h-ed .mod h3 {
  font-size: 17px;
  font-weight: 800;
}
.wj-h-ed .mod p {
  font-size: 13px;
  color: var(--wj-ink-2);
  line-height: 1.75;
  flex: 1;
}
.wj-h-ed .mod-go {
  font-size: 11px;
  letter-spacing: 0.18em;
  font-weight: 700;
  color: var(--wj-accent);
  text-transform: uppercase;
}
.wj-h-ed .stages {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--wj-border-strong);
  border: 1px solid var(--wj-border-strong);
}
.wj-h-ed .stage {
  background: var(--wj-card);
  padding: 26px;
  position: relative;
  transition: box-shadow 0.15s;
}
.wj-h-ed .stage:hover {
  box-shadow: inset 0 0 0 2px var(--wj-accent);
}
.wj-h-ed .stage::after {
  content: '↗';
  position: absolute;
  top: 18px;
  right: 20px;
  color: var(--wj-ink-3);
}
.wj-h-ed .stage .lab {
  font-size: 10.5px;
  letter-spacing: var(--wj-label-tracking);
  color: var(--wj-ink-2);
  text-transform: uppercase;
  font-weight: 600;
}
.wj-h-ed .stage .n {
  font-size: 54px;
  font-weight: 800;
  line-height: 1.15;
  color: var(--wj-ink);
}
.wj-h-ed .stage .n small {
  font-size: 14px;
  color: var(--wj-ink-2);
  margin-left: 8px;
}
.wj-h-ed .stage p {
  font-size: 13px;
  color: var(--wj-ink-2);
  margin-top: 4px;
}
.wj-h-ed .sumline {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--wj-ink-2);
  margin-top: 14px;
  flex-wrap: wrap;
}
.wj-h-ed .sumline b {
  color: var(--wj-ink);
}
.wj-h-ed .dq {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 32px;
  padding: 40px 0;
  border-top: 1px solid var(--wj-border-strong);
  margin-top: 48px;
}
.wj-h-ed .dq .lab {
  font-size: 11px;
  letter-spacing: 0.3em;
  color: var(--wj-accent);
  text-transform: uppercase;
  font-weight: 700;
  margin-bottom: 10px;
}
.wj-h-ed .dq blockquote {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.4;
  color: var(--wj-ink);
}
.wj-h-ed .dq cite {
  font-style: normal;
  font-size: 13px;
  color: var(--wj-ink-2);
  white-space: nowrap;
}

/* ---------------- youth ---------------- */
.wj-h-y .hero {
  padding: 48px 0 32px;
  text-align: center;
}
.wj-h-y .hero-badge {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  background: var(--wj-card);
  border-radius: var(--wj-radius-pill);
  padding: 9px 20px;
  font-size: 13px;
  font-weight: 700;
  color: var(--wj-ink-2);
  box-shadow: var(--wj-shadow);
}
.wj-h-y .hero-badge b {
  color: var(--wj-accent);
}
.wj-h-y h1 {
  font-size: clamp(34px, 4.6vw, 56px);
  font-weight: 800;
  line-height: 1.4;
  margin: 26px 0 14px;
  letter-spacing: 0.01em;
  color: var(--wj-ink);
}
.wj-h-y .grad-text {
  background: var(--wj-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wj-h-y .hero-sub {
  color: var(--wj-ink-2);
  font-size: 16px;
  max-width: 620px;
  margin: 0 auto;
}
.wj-h-y .hero-sub b {
  color: var(--wj-accent);
}
.wj-h-y .hero-btns {
  display: flex;
  gap: 14px;
  justify-content: center;
  margin-top: 30px;
  flex-wrap: wrap;
}
.wj-h-y .btn {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border-radius: var(--wj-radius-pill);
  padding: 14px 32px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.18s;
  border: 0;
}
.wj-h-y .btn-primary {
  background: var(--wj-grad);
  color: #fff;
  box-shadow: 0 12px 26px rgba(124, 92, 224, 0.35);
}
.wj-h-y .btn-primary:hover {
  transform: translateY(-2px);
}
.wj-h-y .btn-white {
  background: var(--wj-card);
  color: var(--wj-accent);
  box-shadow: var(--wj-shadow);
}
.wj-h-y .btn-white:hover {
  transform: translateY(-2px);
}
.wj-h-y .sec-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 48px 0 22px;
  flex-wrap: wrap;
}
.wj-h-y .sec-emoji {
  width: 46px;
  height: 46px;
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  display: grid;
  place-items: center;
  font-size: 22px;
}
.wj-h-y .sec-title {
  font-size: 24px;
  font-weight: 800;
}
.wj-h-y .sec-sub {
  color: var(--wj-ink-2);
  font-size: 13.5px;
  font-weight: 600;
  padding-top: 6px;
}
.wj-h-y .sec-chip {
  margin-left: auto;
  background: var(--wj-card);
  border-radius: var(--wj-radius-pill);
  padding: 7px 16px;
  font-size: 12.5px;
  font-weight: 800;
  color: var(--wj-accent);
  box-shadow: var(--wj-shadow);
}
.wj-h-y .feat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}
.wj-h-y .f-card {
  background: var(--wj-card);
  border-radius: var(--wj-radius);
  padding: 24px;
  box-shadow: var(--wj-shadow);
  transition: all 0.18s;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wj-h-y .f-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--wj-shadow-hover);
}
.wj-h-y .f-ico {
  width: 54px;
  height: 54px;
  border-radius: 17px;
  display: grid;
  place-items: center;
  font-size: 27px;
}
.wj-h-y .ico-01 {
  background: #f0ebff;
}
.wj-h-y .ico-02 {
  background: #e2f7f4;
}
.wj-h-y .ico-03 {
  background: #fff1e3;
}
.wj-h-y .ico-04 {
  background: #fff6df;
}
.wj-h-y .f-card h3 {
  font-size: 17.5px;
  font-weight: 800;
  margin-top: 6px;
}
.wj-h-y .f-card p {
  font-size: 13px;
  color: var(--wj-ink-2);
  line-height: 1.75;
  flex: 1;
}
.wj-h-y .f-link {
  font-size: 13px;
  font-weight: 800;
  color: var(--wj-accent);
}
.wj-h-y .stages {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.wj-h-y .stage {
  background: var(--wj-card);
  border-radius: var(--wj-radius);
  padding: 22px 24px;
  box-shadow: var(--wj-shadow);
  transition: all 0.18s;
}
.wj-h-y .stage:hover {
  transform: translateY(-4px);
  box-shadow: var(--wj-shadow-hover);
}
.wj-h-y .stage-top {
  display: flex;
  align-items: center;
  gap: 14px;
}
.wj-h-y .stage-emoji {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  background: var(--wj-bg-soft);
  display: grid;
  place-items: center;
  font-size: 28px;
  flex: none;
}
.wj-h-y .stage-name {
  font-size: 17px;
  font-weight: 800;
}
.wj-h-y .stage-desc {
  font-size: 12.5px;
  color: var(--wj-ink-2);
  margin-top: 1px;
}
.wj-h-y .stage-num {
  margin-left: auto;
  text-align: right;
}
.wj-h-y .stage-num b {
  font-size: 25px;
  font-weight: 800;
}
.wj-h-y .stage-num small {
  font-size: 12px;
  color: var(--wj-ink-2);
  font-weight: 700;
  margin-left: 3px;
}
.wj-h-y .stage-bar {
  height: 9px;
  border-radius: var(--wj-radius-pill);
  background: var(--wj-bg-soft);
  margin-top: 16px;
  overflow: hidden;
}
.wj-h-y .stage-bar i {
  display: block;
  height: 100%;
  border-radius: var(--wj-radius-pill);
}
.wj-h-y .stage-cap {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--wj-ink-2);
  font-weight: 700;
  margin-top: 7px;
}
.wj-h-y .quote-card {
  background: linear-gradient(120deg, rgba(124, 92, 224, 0.12), rgba(255, 155, 71, 0.14)), var(--wj-card);
  border-radius: 28px;
  padding: 32px 36px;
  display: flex;
  align-items: center;
  gap: 24px;
  box-shadow: var(--wj-shadow);
  margin-top: 24px;
  flex-wrap: wrap;
}
.wj-h-y .q-emoji {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  display: grid;
  place-items: center;
  font-size: 34px;
  flex: none;
}
.wj-h-y .q-mid {
  flex: 1;
  min-width: 240px;
}
.wj-h-y .q-label {
  display: inline-block;
  background: var(--wj-accent-tint);
  color: var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  padding: 4px 14px;
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 9px;
}
.wj-h-y .q-mid blockquote {
  font-size: 21px;
  font-weight: 800;
  line-height: 1.6;
}
.wj-h-y .q-mid cite {
  font-style: normal;
  font-size: 13px;
  color: var(--wj-ink-2);
  font-weight: 600;
}
.wj-h-y .q-btn {
  background: var(--wj-card);
  border: 0;
  border-radius: var(--wj-radius-pill);
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 800;
  color: var(--wj-accent);
  box-shadow: var(--wj-shadow);
  cursor: pointer;
  transition: all 0.16s;
}
.wj-h-y .q-btn:hover {
  transform: translateY(-2px);
}

/* ---------------- 响应式 ---------------- */
@media (max-width: 1020px) {
  .wj-h-ink .hero,
  .wj-h-ed .hero {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .wj-h-ink .feat-grid,
  .wj-h-y .feat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .wj-h-ink .stages,
  .wj-h-ed .stages,
  .wj-h-y .stages {
    grid-template-columns: 1fr;
  }
  .wj-h-ed .mods {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .wj-h-ed .hstats {
    border-left: 0;
    padding-left: 0;
    border-top: 1px solid var(--wj-border-strong);
    padding-top: 6px;
  }
}
@media (max-width: 640px) {
  .wj-h-ink .feat-grid,
  .wj-h-y .feat-grid,
  .wj-h-ed .mods {
    grid-template-columns: 1fr;
  }
  .wj-h-ink .quote-card {
    padding: 32px 20px;
  }
  .wj-h-ink .q-seal {
    display: none;
  }
  .wj-h-ink .title-tag {
    height: 200px;
  }
}
</style>
