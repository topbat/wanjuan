<script setup lang="ts">
// 万卷 · 知识图谱（ECharts graph 力导向布局）
// 数据源：/indexes/graph.json（由 scripts/build-index.mjs 构建）
// 主题：节点分色按主题语义色（宣纸=朱砂墨色 / 编辑=克莱因蓝黑 / 少年=多彩糖纸），切换主题后整图重绘。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  chartPalette,
  cssVar,
  currentTheme,
  graphTypeColor,
  onThemeChange,
} from '../composables/useWjTheme'

const el = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref('')
const selected = ref<Record<string, unknown> | null>(null)

const TYPE_LABEL: Record<string, string> = {
  poem: '作品', author: '作者', idiom: '成语', quote: '名句', imagery: '意象',
  dynasty: '朝代', form: '体裁', genre: '题材', theme: '主题', stage: '学段',
  allusion: '典故', concept: '概念',
}

let chart: any = null
let graphData: any = null
const offThemeChange = onThemeChange(() => render())
const onResize = () => chart?.resize()

function render() {
  if (!chart || !graphData) return
  const theme = currentTheme()
  const displayFont = cssVar('--wj-font-display') || 'sans-serif'
  const types = [...new Set<string>(graphData.nodes.map((n: any) => n.type))]

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
          bottom: 0,
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
          force: { repulsion: 130, edgeLength: [40, 100], gravity: 0.06, friction: 0.2 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
          label: { show: true, position: 'right', fontSize: 10, color: cssVar('--wj-ink') || '#111' },
          lineStyle: { color: 'source', curveness: 0.08, opacity: 0.45, width: 1 },
          data: graphData.nodes.map((n: any) => ({
            id: n.id,
            name: n.label,
            category: types.indexOf(n.type),
            value: n.degree,
            symbolSize: 14 + Math.min(26, n.degree * 3),
            itemStyle: { color: graphTypeColor(n.type, theme) },
            rawType: n.type,
            anchor: n.anchor,
          })),
          links: graphData.links.map((l: any) => ({ source: l.source, target: l.target, rel: l.rel, value: l.rel })),
        },
      ],
      color: chartPalette(),
    },
    { notMerge: true },
  )
}

onMounted(async () => {
  try {
    const echarts = await import('echarts')
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/graph.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    graphData = await res.json()

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
    loading.value = false
  } catch (err: any) {
    loading.value = false
    failed.value = err?.message ?? String(err)
  }
})

onBeforeUnmount(() => {
  offThemeChange()
  window.removeEventListener('resize', onResize)
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
