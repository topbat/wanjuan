// 万卷 · URL 状态同步（筛选与页码可分享、可刷新、后退正确）
// 用法：
//   const { state, setState } = useUrlState({ q: '', semantic: [] as string[], page: 1 })
//   多值字段用逗号连接；更新走 replaceState，避免污染历史记录。
import { onMounted, ref, watch } from 'vue'

type Primitive = string | number | boolean
export type UrlStateShape = Record<string, Primitive | string[]>

function encode(v: Primitive | string[]): string {
  return Array.isArray(v) ? v.join(',') : String(v)
}

export function useUrlState<T extends UrlStateShape>(defaults: T) {
  const state = ref({ ...defaults }) as { value: T }

  const parse = () => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const next: Record<string, unknown> = { ...defaults }
    for (const key of Object.keys(defaults)) {
      const raw = sp.get(key)
      if (raw === null) continue
      const def = defaults[key]
      if (Array.isArray(def)) next[key] = raw ? raw.split(',').filter(Boolean) : []
      else if (typeof def === 'number') next[key] = Number(raw) || def
      else if (typeof def === 'boolean') next[key] = raw === '1' || raw === 'true'
      else next[key] = raw
    }
    state.value = next as T
  }

  const write = () => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams()
    for (const [key, value] of Object.entries(state.value)) {
      const def = (defaults as Record<string, unknown>)[key]
      const isEmpty =
        (Array.isArray(value) && value.length === 0) ||
        value === '' || value === null || value === undefined ||
        (typeof value === 'number' && value === def) ||
        (typeof value === 'boolean' && value === def)
      if (isEmpty) continue
      sp.set(key, encode(value as Primitive | string[]))
    }
    const qs = sp.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', url)
  }

  onMounted(parse)
  watch(state, write, { deep: true })

  return {
    state,
    reload: parse,
    setState: (patch: Partial<T>) => {
      state.value = { ...state.value, ...patch } as T
    },
    reset: () => {
      state.value = { ...defaults } as T
    },
  }
}
