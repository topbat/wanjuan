<script setup lang="ts">
// 万卷 · 知识图谱（ECharts graph 力导向布局）
// 数据源：/indexes/graph.json（由 scripts/build-index.mjs 构建）
// 主题：节点分色按主题语义色（宣纸=朱砂墨色 / 编辑=克莱因蓝黑 / 少年=多彩糖纸），切换主题后整图重绘。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  chartPalette,
  cssVar,
  currentTheme,
  graphTypeColor,
  onThemeChange,
  onAppearanceChange,
} from '../composables/useWjTheme'

const el = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref('')
const selected = ref<Record<string, unknown> | null>(null)
// 全图 1200+ 节点直接力导向会糊成一团：默认只渲染度数≥2 的骨干节点，可切换查看全量
const showAll = ref(false)
const query = ref('')
const totalCount = computed(() => graphData?.nodes?.length ?? 0)
const visibleCount = computed(() => visibleCountRef.value)
const visibleCountRef = ref(0)
const FOCUS_MIN_DEGREE = 3
const FOCUS_MAX_NODES = 120

const TYPE_LABEL: Record<string, string> = {
  poem: '作品', author: '作者', idiom: '成语', quote: '名句', imagery: '意象',
  dynasty: '朝代', form: '体裁', genre: '题材', theme: '主题', stage: '学段',
  allusion: '典故', concept: '概念',
}

let chart: any = null
let ro: any = null
let graphData: any = null
const offThemeChange = onThemeChange(() => render())
const offAppearance = onAppearanceChange(() => render())
const onResize = () => chart?.resize()

function render(opts: { resetLayout?: boolean } = {}) {
  if (!chart || !graphData) return
  const theme = currentTheme()
  const displayFont = cssVar('--wj-font-display') || 'sans-serif'
  const types = [...new Set<string>(graphData.nodes.map((n: any) => n.type))]
  // 默认聚焦：度数达标或属于结构性节点的骨干子图（按度数降序截断到 FOCUS_MAX_NODES）
  const structural = new Set(['dynasty', 'stage', 'form', 'genre'])
  let visibleNodes = graphData.nodes
  if (query.value.trim()) {
    // 名称检索：命中节点 + 其直接邻居，构成局部子图
    const q = query.value.trim()
    const hitIds = new Set(graphData.nodes.filter((n: any) => String(n.label).includes(q)).map((n: any) => n.id))
    const neighbor = new Set(hitIds)
    for (const l of graphData.links) {
      if (hitIds.has(l.source)) neighbor.add(l.target)
      if (hitIds.has(l.target)) neighbor.add(l.source)
    }
    visibleNodes = graphData.nodes.filter((n: any) => neighbor.has(n.id))
    graphData.__visibleLinks = graphData.links.filter((l: any) => neighbor.has(l.source) && neighbor.has(l.target))
  } else if (!showAll.value) {
    const keep = graphData.nodes
      .filter((n: any) => n.degree >= FOCUS_MIN_DEGREE || structural.has(n.type))
      .sort((a: any, b: any) => b.degree - a.degree)
      .slice(0, FOCUS_MAX_NODES)
    const ids = new Set(keep.map((n: any) => n.id))
    visibleNodes = keep
    graphData.__visibleLinks = graphData.links.filter((l: any) => ids.has(l.source) && ids.has(l.target))
  } else {
    graphData.__visibleLinks = graphData.links
  }
  const visibleLinks = graphData.__visibleLinks
  // 标签只给「核心节点」：按度数取前 36 个，其余悬停显示，避免中文标签互相压盖
  const labelTop = new Set(
    [...visibleNodes].sort((a: any, b: any) => b.degree - a.degree).slice(0, 36).map((n: any) => n.id),
  )
  visibleCountRef.value = visibleNodes.length

  chart.setOption(
    {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: displayFont, color: cssVar('--wj-ink-2') || '#555' },
      tooltip: {
        confine: true,
        backgroundColor: cssVar('--wj-card') || '#fff',
        borderColor: cssVar('--wj-line') || '#ddd',
        textStyle: { color: cssVar('--wj-ink') || '#111', fontFamily: displayFont, fontSize: 12 },
        formatter: (p: any) => {
          if (p.dataType === 'edge') {
            return `${p.data.source} —<b>${p.data.rel}</b>→ ${p.data.target}`
          }
          return [
            `<b>${p.name}</b>`,
            `类型：${TYPE_LABEL[p.data.rawType] ?? p.data.rawType} · 度数 ${p.value ?? 0}`,
            p.data.anchor ? `源文件：${p.data.anchor}` : '（无源文件）',
            '点击节点可在控制台与下方查看详情',
          ].join('<br/>')
        },
      },
      legend: [
        {
          data: types.map((t) => TYPE_LABEL[t] ?? t),
          type: 'scroll',
          top: 0,
          textStyle: { fontFamily: displayFont, color: cssVar('--wj-ink-2') || '#555' },
        },
      ],
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          categories: types.map((t) => ({ name: TYPE_LABEL[t] ?? t })),
          force: { repulsion: 600, edgeLength: [90, 180], gravity: 0.04, friction: 0.12 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
          // 标签只给骨干节点显示，其余悬停出现；labelLayout 自动避让，避免文字糊成一团
          label: {
            show: true, position: 'right', fontSize: 11,
            color: cssVar('--wj-ink') || '#111',
            formatter: (p: any) => (labelTop.has(p.data.id) ? p.name : ''),
          },
          labelLayout: { hideOverlap: true },
          lineStyle: { color: 'source', curveness: 0.08, opacity: 0.35, width: 1 },
          data: visibleNodes.map((n: any) => ({
            id: n.id,
            name: n.label,
            category: types.indexOf(n.type),
            value: n.degree,
            symbolSize: 14 + Math.min(26, n.degree * 3),
            itemStyle: { color: graphTypeColor(n.type, theme) },
            rawType: n.type,
            anchor: n.anchor,
            degree: n.degree,
          })),
          links: visibleLinks.map((l: any) => ({ source: l.source, target: l.target, rel: l.rel, value: l.rel })),
        },
      ],
      color: chartPalette(),
    },
    { notMerge: true },
  )
}

watch(showAll, () => render({ resetLayout: true }))
watch(query, () => render({ resetLayout: true }))

onMounted(async () => {
  try {
    const echarts = await import('echarts')
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/graph.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    graphData = await res.json()

    // 关键：容器此前为 display:none（v-show），ECharts 会以 0 宽初始化并回退到 100px，
    // 因此先让容器可见并在下一帧完成布局后再初始化。
    loading.value = false
    await nextTick()
    chart = echarts.init(el.value!)
    render()

    // 点击事件：console 输出 + 下方信息卡提示（含回源 anchor）
    chart.on('click', (params: any) => {
      if (params.dataType === 'node') {
        selected.value = params.data
        console.log('[万卷·图谱] 点击节点：', {
          id: params.data.id,
          label: params.data.name,
          type: params.data.rawType,
          degree: params.data.value,
          anchor: params.data.anchor,
        })
      }
    })

    window.addEventListener('resize', onResize)
    if (typeof ResizeObserver !== 'undefined' && el.value) {
      ro = new ResizeObserver(() => chart && chart.resize())
      ro.observe(el.value)
    }
    loading.value = false
  } catch (err: any) {
    loading.value = false
    failed.value = err?.message ?? String(err)
  }
})

onBeforeUnmount(() => {
  offThemeChange()
  offAppearance()
  window.removeEventListener('resize', onResize)
  ro?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div>
    <p v-if="loading" class="wj-note">正在加载图谱数据（/indexes/graph.json）…若首次使用，请先运行 <code>npm run build:index</code>。</p>
    <p v-else-if="failed" class="wj-note">
      图谱数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引，并确认
      <code>site/public/indexes/graph.json</code> 存在。
    </p>
    <div v-if="!loading && !failed" class="wj-graph-bar">
      <span class="wj-graph-count">当前显示 <b>{{ visibleCount }}</b> / {{ totalCount }} 个节点</span>
      <input
        v-model="query"
        class="wj-graph-search"
        type="search"
        placeholder="输入名称定位：李白 / 月 / 将进酒"
      />
      <label class="wj-switch">
        <input v-model="showAll" type="checkbox" />
        <span>显示全部节点</span>
      </label>
      <span class="wj-note">悬停聚焦邻域 · 点击查看详情 · 滚轮缩放 · 拖拽平移</span>
    </div>
    <div v-show="!loading && !failed" ref="el" class="wj-chart" style="height: 620px"></div>

    <div v-if="selected" class="wj-node-card">
      <p>
        <b>{{ selected.name }}</b>
        <span class="wj-chip">{{ TYPE_LABEL[selected.rawType as string] ?? selected.rawType }}</span>
        <span class="wj-chip">度数 {{ selected.value }}</span>
      </p>
      <p v-if="selected.anchor" class="wj-note">
        源文件：<code>{{ selected.anchor }}</code>
        <a v-if="selected.anchor" :href="'https://github.com/topbat/wanjuan/edit/main/' + selected.anchor" target="_blank" rel="noreferrer">
          在 GitHub 上查看
        </a>
      </p>
      <p v-else class="wj-note">该节点为派生概念节点（无独立源文件）。</p>
    </div>
  </div>
</template>

<style scoped>
.wj-node-card {
  margin-top: 12px;
  padding: 12px 16px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
}
.wj-chip {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 10px;
  border-radius: var(--wj-radius-pill);
  font-size: 12px;
  border: 1px solid var(--wj-line);
  color: var(--wj-ink-2);
}
</style>
