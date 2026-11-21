<script setup lang="ts">
// 万卷 · 主题词云（echarts-wordcloud）
// 数据源：/indexes/stats.json（构建期词频统计）
import { onBeforeUnmount, onMounted, ref } from 'vue'

type WordItem = { name: string; value: number }
type Stats = { wordFreq: WordItem[]; imageryDist: WordItem[]; quoteThemeDist: WordItem[]; topAuthors: WordItem[] }

const el = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref('')
const dim = ref<'wordFreq' | 'imageryDist' | 'quoteThemeDist'>('wordFreq')

const DIM_META: Record<string, { label: string; hint: string }> = {
  wordFreq: { label: '作品词频', hint: '对全部作品正文分词后的高频词（Top 50）' },
  imageryDist: { label: '意象分布', hint: '作品 frontmatter 中意象标签的出现次数' },
  quoteThemeDist: { label: '名句主题', hint: '名句适用主题（作文引用场景）计数' },
}

let chart: any = null
let stats: Stats | null = null
const onResize = () => chart?.resize()

async function render() {
  if (!chart || !stats) return
  const data = stats[dim.value] ?? []
  chart.setOption(
    {
      title: { text: DIM_META[dim.value].hint, left: 'center', top: 8, textStyle: { fontSize: 13, fontWeight: 'normal', color: '#8a8f98' } },
      series: [
        {
          type: 'wordCloud',
          shape: 'circle',
          left: 'center',
          top: 'middle',
          width: '92%',
          height: '90%',
          sizeRange: [14, 66],
          rotationRange: [-45, 0, 45, 90],
          rotationStep: 45,
          gridSize: 8,
          drawOutOfBound: false,
          layoutAnimation: true,
          textStyle: {
            fontFamily: 'sans-serif',
            fontWeight: 'bold',
            color: () =>
              '#4a6785,#7c6ee6,#4a9e8f,#e0794a,#c25e8e,#5d8cc9,#b08830,#6a9b56'.split(',')[
                Math.floor(Math.random() * 8)
              ],
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
    chart = echarts.init(el.value!)
    await render()
    window.addEventListener('resize', onResize)
    loading.value = false
  } catch (err: any) {
    loading.value = false
    failed.value = err?.message ?? String(err)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
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
