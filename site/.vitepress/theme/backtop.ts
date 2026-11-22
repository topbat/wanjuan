/**
 * 万卷 · 返回顶部（纯 DOM 注入）
 *
 * 为什么不用 Vue 组件插槽：VitePress 的 layout-bottom 等插槽在静态输出后，
 * 客户端 hydrate 时机不稳定，导致按钮渲染出来却绑不上事件（实测点击无效）。
 * 这里改为在客户端直接创建元素并绑定原生监听，行为确定、零依赖渲染时序。
 */
let mounted = false

export function mountBackToTop(): void {
  if (mounted || typeof window === 'undefined') return
  mounted = true

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'wj-backtop'
  btn.setAttribute('aria-label', '返回顶部')
  btn.title = '返回顶部'
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
    </svg>
    <span>顶部</span>
    <span class="wj-backtop-ring" aria-hidden="true"></span>
  `

  const ring = btn.querySelector('.wj-backtop-ring') as HTMLElement | null

  // 顶部阅读进度条（长页面的"我在哪"提示）
  const bar = document.createElement('div')
  bar.className = 'wj-progress'
  bar.setAttribute('aria-hidden', 'true')
  document.body.appendChild(bar)
  const THRESHOLD = 420
  let raf = 0

  const apply = () => {
    raf = 0
    const y = window.scrollY || document.documentElement.scrollTop || 0
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const show = y > THRESHOLD
    btn.style.opacity = show ? '1' : '0'
    btn.style.transform = show ? 'translateY(0)' : 'translateY(12px)'
    btn.style.pointerEvents = show ? 'auto' : 'none'
    const ratio = Math.min(1, y / max)
    ring?.style.setProperty('--p', String(ratio))
    bar.style.transform = `scaleX(${ratio})`
  }

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply)
  }

  btn.addEventListener('click', () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  })

  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)

  document.body.appendChild(btn)
  apply()
}