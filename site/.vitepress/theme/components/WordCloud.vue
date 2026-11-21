<script setup lang="ts">
// 万卷 · 主题词云（echarts-wordcloud）
// 数据源：/indexes/stats.json（构建期词频统计）
// 主题：词色取自 --wj-chart-* 调色板（宣纸=朱砂墨赭 / 编辑=蓝黑 / 少年=多彩），切换主题后重绘。
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { chartPalette, cssVar, onThemeChange } from '../composables/useWjTheme'

type WordItem = { name: string; value: number }
type Stats = { imageryFreq: WordItem[]; topAuthors: WordItem[]; quoteThemeDist: WordItem[] }

const el = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref('')
const dim = ref<'imageryFreq' | 'topAuthors' | 'quoteThemeDist'>('imageryFreq')

const DIM_META: Record<string, { label: string; hint: string }> = {
  imageryFreq: { label: '意象词云', hint: '经典意象在全部作品正文中的出现次数（山、月、风、江、云…）' },
  topAuthors: { label: '高频诗人', hint: '按作品数统计的作者排行' },
  quoteThemeDist: { label: '名句主题', hint: '名句适用主题（作文引用场景）计数' },
}

let chart: any = null
let ro: any = null
let stats: Stats | null = null
const offThemeChange = onThemeChange(() => render())
const onResize = () => chart?.resize()

function render() {
  if (!chart || !stats) return
  const palette = chartPalette()
  const displayFont = cssVar('--wj-font-display') || 'sans-serif'
  const data = stats[dim.value] ?? []
  chart.setOption(
    {
      backgroundColor: 'transparent',
      series: [
        {
          type: 'wordCloud',
          shape: 'circle',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          sizeRange: [22, 96],
          rotationRange: [0, 0],
          rotationStep: 0,
          gridSize: 4,
          drawOutOfBound: false,
          layoutAnimation: true,
          textStyle: {
            fontFamily: displayFont,
            fontWeight: 'bold',
            color: () => palette[Math.floor(Math.random() * palette.length)] || '#4a6785',
          },
          emphasis: { focus: 'self', textStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.25)' } },
          data,
        },
      ],
    },
    { notMerge: true },
  )
}

onMounted(async () => {
  try {
    const echarts = await import('echarts')
    await import('echarts-wordcloud')
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
        v-for="(meta, key) in DIM_META"
        :key="key"
        :class="{ active: dim === key }"
        @click="dim = key as any; render()"
      >
        {{ meta.label }}
      </button>
    </div>
    <p v-if="loading" class="wj-note">正在加载统计数据（/indexes/stats.json）…若首次使用，请先运行 <code>npm run build:index</code>。</p>
    <p v-else-if="failed" class="wj-note">统计数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code>。</p>
    <div v-show="!loading && !failed" ref="el" class="wj-chart" style="height: 560px"></div>
  </div>
</template>
