<script setup lang="ts">
// 万卷 · 双轨标签统计（treemap / 旭日切换）
// 数据源：/indexes/stats.json —— 文学本体轨（题材/体裁/朝代/意象/标签）+ 课标轨（年级）
// 主题：色板取自 --wj-chart-*（宣纸=朱砂墨赭 / 编辑=蓝黑 / 少年=多彩），切换主题后重绘。
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { chartPalette, cssVar, onThemeChange, onAppearanceChange } from '../composables/useWjTheme'

type Item = { name: string; value: number }
type Stats = {
  genreDist: Item[]
  formDist: Item[]
  dynastyDist: Item[]
  imageryDist: Item[]
  tagCounts: Record<string, number>
  curriculum: { byStage: Record<string, number>; byGrade: Item[] }
}

const el = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref('')
const dim = ref<'genreDist' | 'formDist' | 'dynastyDist' | 'imageryDist' | 'tagCounts' | 'byGrade'>('dynastyDist')
const mode = ref<'treemap' | 'sunburst'>('treemap')

const DIM_LABEL: Record<string, string> = {
  genreDist: '题材',
  formDist: '体裁',
  dynastyDist: '朝代',
  imageryDist: '意象',
  tagCounts: '标签',
  byGrade: '课标年级',
}

let chart: any = null
let ro: any = null
let stats: Stats | null = null
const offThemeChange = onThemeChange(() => render())
const offAppearance = onAppearanceChange(() => render())
const onResize = () => chart?.resize()

function dataOf(): Item[] {
  if (!stats) return []
  if (dim.value === 'tagCounts') {
    return Object.entries(stats.tagCounts ?? {}).map(([name, value]) => ({ name, value }))
  }
  if (dim.value === 'byGrade') return stats.curriculum?.byGrade ?? []
  return (stats as any)[dim.value] ?? []
}

function render() {
  if (!chart) return
  const palette = chartPalette()
  const displayFont = cssVar('--wj-font-display') || 'sans-serif'
  const ink = cssVar('--wj-ink') || '#111'
  const data = dataOf()
  if (mode.value === 'treemap') {
    chart.setOption(
      {
        backgroundColor: 'transparent',
        color: palette,
        textStyle: { fontFamily: displayFont },
        tooltip: {
          backgroundColor: cssVar('--wj-card') || '#fff',
          borderColor: cssVar('--wj-line') || '#ddd',
          textStyle: { color: ink, fontFamily: displayFont, fontSize: 12 },
          formatter: (p: any) => `${p.name}<br/>收录 ${p.value} 篇`,
        },
        series: [
          {
            type: 'treemap',
            roam: false,
            breadcrumb: { show: true, itemStyle: { textStyle: { color: cssVar('--wj-ink-3') || '#999' } } },
            label: { show: true, formatter: '{b}\n{c}', fontFamily: displayFont },
            itemStyle: { borderColor: cssVar('--wj-card') || '#fff', gapWidth: 2 },
            upperLabel: {
              show: true,
              height: 22,
              color: '#ffffff',
              textShadowColor: 'rgba(0,0,0,.35)',
              textShadowBlur: 2,
            },
            levels: [
              { itemStyle: { borderWidth: 0, gapWidth: 3 } },
              {
                itemStyle: { gapWidth: 1, borderColorSaturation: 0.5 },
                colorSaturation: [0.3, 0.55],
              },
            ],
            data,
          },
        ],
      },
      { notMerge: true },
    )
  } else {
    chart.setOption(
      {
        backgroundColor: 'transparent',
        color: palette,
        textStyle: { fontFamily: displayFont },
        tooltip: {
          backgroundColor: cssVar('--wj-card') || '#fff',
          borderColor: cssVar('--wj-line') || '#ddd',
          textStyle: { color: ink, fontFamily: displayFont, fontSize: 12 },
          formatter: (p: any) => `${p.name}<br/>收录 ${p.value} 篇`,
        },
        series: [
          {
            type: 'sunburst',
            radius: [36, '92%'],
            itemStyle: { borderRadius: 4, borderWidth: 1.5, borderColor: cssVar('--wj-card') || '#fff' },
            label: { rotate: 'radial', fontSize: 11, fontFamily: displayFont, color: ink },
            data,
          },
        ],
      },
      { notMerge: true },
    )
  }
}

onMounted(async () => {
  try {
    const echarts = await import('echarts')
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/stats.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    stats = await res.json()
    // 关键：容器此前为 display:none（v-show），ECharts 会以 0 宽初始化并回退到 100px，
    // 因此先让容器可见并在下一帧完成布局后再初始化。
    loading.value = false
    await nextTick()
    chart = echarts.init(el.value!)
    render()
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
    <div class="wj-toolbar">
      <button
        v-for="(label, key) in DIM_LABEL"
        :key="key"
        :class="{ active: dim === key }"
        @click="dim = key as any; render()"
      >
        {{ label }}
      </button>
      <span style="width: 12px"></span>
      <button :class="{ active: mode === 'treemap' }" @click="mode = 'treemap'; render()">矩形树图</button>
      <button :class="{ active: mode === 'sunburst' }" @click="mode = 'sunburst'; render()">旭日图</button>
    </div>
    <p class="wj-note">文学本体轨（题材 / 体裁 / 朝代 / 意象 / 标签）与课标轨（年级分布）双轨并列，可交叉观察课标覆盖进度。</p>
    <p v-if="loading" class="wj-note">正在加载统计数据（/indexes/stats.json）…若首次使用，请先运行 <code>npm run build:index</code>。</p>
    <p v-else-if="failed" class="wj-note">统计数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code>。</p>
    <div v-show="!loading && !failed" ref="el" class="wj-chart" style="height: 560px"></div>
  </div>
</template>
