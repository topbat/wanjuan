<script setup lang="ts">
// 万卷 · 知识图谱（ECharts graph 力导向布局）
// 数据源：/indexes/graph.json（由 scripts/build-index.mjs 构建）
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

const el = ref<HTMLElement | null>(null)
const loading = ref(true)
const failed = ref('')
const selected = ref<Record<string, unknown> | null>(null)

// 节点类型 → 中文名与配色（中性色板，后续随 UI 风格重绘）
const TYPE_META: Record<string, { label: string; color: string }> = {
  poem: { label: '作品', color: '#7c6ee6' },
  author: { label: '作者', color: '#e0794a' },
  idiom: { label: '成语', color: '#4a9e8f' },
  quote: { label: '名句', color: '#c25e8e' },
  imagery: { label: '意象', color: '#5d8cc9' },
  dynasty: { label: '朝代', color: '#8a8f98' },
  form: { label: '体裁', color: '#b08830' },
  genre: { label: '题材', color: '#6a9b56' },
  theme: { label: '主题', color: '#9a77b8' },
  stage: { label: '学段', color: '#996b5c' },
  allusion: { label: '典故', color: '#5f7d8c' },
  concept: { label: '概念', color: '#7d7d7d' },
}

let chart: { resize: () => void; dispose: () => void; on: (t: string, h: (p: any) => void) => void; setOption: (o: any) => void } | null = null

const onResize = () => chart?.resize()

onMounted(async () => {
  try {
    const echarts = await import('echarts')
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/graph.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    const types = [...new Set<string>(data.nodes.map((n: any) => n.type))]
      .sort((a, b) => (TYPE_META[b] ? 1 : 0) - (TYPE_META[a] ? 1 : 0))

    chart = echarts.init(el.value!) as any
    ;(chart as any).setOption({
      tooltip: {
        confine: true,
        formatter: (p: any) => {
          if (p.dataType === 'edge') {
            return `${p.data.source} —<b>${p.data.rel}</b>→ ${p.data.target}`
          }
          const meta = TYPE_META[p.data.rawType] ?? { label: p.data.rawType }
          return [
            `<b>${p.name}</b>`,
            `类型：${meta.label} · 度数 ${p.value ?? 0}`,
            p.data.anchor ? `源文件：${p.data.anchor}` : '（无源文件）',
            '点击节点可在控制台与下方查看详情',
          ].join('<br/>')
        },
      },
      legend: [
        {
          data: types.map((t) => TYPE_META[t]?.label ?? t),
          type: 'scroll',
          orient: 'horizontal',
          bottom: 0,
        },
      ],
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          categories: types.map((t) => ({ name: TYPE_META[t]?.label ?? t })),
          force: { repulsion: 130, edgeLength: [40, 100], gravity: 0.06, friction: 0.2 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
          label: { show: true, position: 'right', fontSize: 10, color: 'inherit' },
          lineStyle: { color: 'source', curveness: 0.08, opacity: 0.45, width: 1 },
          data: data.nodes.map((n: any) => ({
            id: n.id,
            name: n.label,
            category: types.indexOf(n.type),
            value: n.degree,
            symbolSize: 14 + Math.min(26, n.degree * 3),
            itemStyle: { color: TYPE_META[n.type]?.color ?? '#7d7d7d' },
            rawType: n.type,
            anchor: n.anchor,
          })),
          links: data.links.map((l: any) => ({ source: l.source, target: l.target, rel: l.rel, value: l.rel })),
        },
      ],
    })

    // 点击事件：console 输出 + 下方信息卡提示（含回源 anchor）
    ;(chart as any).on('click', (params: any) => {
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
        <span class="wj-chip">{{ TYPE_META[selected.rawType as string]?.label ?? selected.rawType }}</span>
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
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.wj-chip {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}
</style>
