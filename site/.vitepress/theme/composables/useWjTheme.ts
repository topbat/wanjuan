/**
 * 万卷 · 主题组合式工具
 *
 * 主题列表：editorial（默认）/ ink / youth
 * 切换机制：html[data-theme] + localStorage('wj-theme') + window 'wj-theme-change' 事件
 * ECharts 组件通过 onThemeChange 监听并重绘。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

export type WjThemeName = 'editorial' | 'ink' | 'youth'

export const WJ_THEMES: { id: WjThemeName; label: string; dot: string }[] = [
  { id: 'editorial', label: '编辑', dot: '#0042e6' },
  { id: 'ink', label: '宣纸', dot: '#a83f2e' },
  { id: 'youth', label: '少年', dot: 'linear-gradient(120deg,#7c5ce0,#ff9b47)' },
]

const THEME_IDS = WJ_THEMES.map((t) => t.id)
export const THEME_EVENT = 'wj-theme-change'

export function isValidTheme(v: unknown): v is WjThemeName {
  return typeof v === 'string' && (THEME_IDS as string[]).includes(v)
}

/** 当前主题（仅客户端调用；SSR 返回默认 editorial） */
export function currentTheme(): WjThemeName {
  if (typeof document === 'undefined') return 'editorial'
  const t = document.documentElement.getAttribute('data-theme')
  return isValidTheme(t) ? t : 'editorial'
}

/** 切换主题：写属性 + 持久化 + 广播事件（图表重绘、首页分支刷新） */
export function setTheme(theme: WjThemeName) {
  if (!isValidTheme(theme)) return
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('wj-theme', theme)
  } catch {
    /* 隐私模式下忽略 */
  }
  window.dispatchEvent(new CustomEvent<WjThemeName>(THEME_EVENT, { detail: theme }))
}

/** 读取 CSS 自定义属性（运行时实时值，随主题切换变化） */
export function cssVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** 图表 8 色调色板（--wj-chart-1..8） */
export function chartPalette(): string[] {
  return Array.from({ length: 8 }, (_, i) => cssVar(`--wj-chart-${i + 1}`)).filter(Boolean)
}

/** 图谱节点类型 → 主题语义色（各提案的节点分色规范） */
const GRAPH_COLORS: Record<WjThemeName, Record<string, string>> = {
  ink: {
    poem: '#a83f2e', author: '#59544a', idiom: '#8f3223', quote: '#b08830', imagery: '#6a9b56',
    dynasty: '#9b9182', form: '#7a6e5f', genre: '#4e6b78', theme: '#996b5c', stage: '#59544a',
    allusion: '#a83f2e', concept: '#9b9182',
  },
  editorial: {
    poem: '#0042e6', author: '#111111', idiom: '#555555', quote: '#8fa4ff', imagery: '#0031ab',
    dynasty: '#9c9c98', form: '#111111', genre: '#4d6bd8', theme: '#7290ff', stage: '#555555',
    allusion: '#111111', concept: '#9c9c98',
  },
  youth: {
    poem: '#7c5ce0', author: '#ff9b47', idiom: '#2fbfae', quote: '#ff7b9c', imagery: '#5b8def',
    dynasty: '#a9a5be', form: '#f5b93b', genre: '#2fbfae', theme: '#ff7b9c', stage: '#7c5ce0',
    allusion: '#e07b2a', concept: '#a9a5be',
  },
}

export function graphTypeColor(type: string, theme: WjThemeName = currentTheme()): string {
  return GRAPH_COLORS[theme]?.[type] ?? '#7d7d7d'
}

/** 响应式主题 ref（SSR 初值为 editorial，挂载后同步真实值并跟随切换） */
export function useWjTheme() {
  const theme = ref<WjThemeName>('editorial')
  const sync = () => {
    theme.value = currentTheme()
  }
  onMounted(() => {
    sync()
    window.addEventListener(THEME_EVENT, sync)
  })
  onBeforeUnmount(() => {
    window.removeEventListener(THEME_EVENT, sync)
  })
  return theme
}

/** 客户端主题变化监听（ECharts 组件重绘用），返回解绑函数 */
export function onThemeChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(THEME_EVENT, handler)
  return () => window.removeEventListener(THEME_EVENT, handler)
}

/**
 * 明暗切换监听（VitePress 在 <html> 上切换 .dark 类）。
 * 与 onThemeChange 一起使用：图形/图表在任一变化时都应重绘。
 */
export function onAppearanceChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const target = document.documentElement
  const obs = new MutationObserver(() => cb())
  obs.observe(target, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}
