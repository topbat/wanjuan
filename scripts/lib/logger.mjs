/**
 * 万卷 · 中文生产级日志组件
 *
 * 用法：
 *   import { createLogger, format } from './lib/logger.mjs'
 *   const log = createLogger({ verbose: true })   // --verbose 时输出 [详细]
 *   log.info('扫描 {0} 个文件', 47)               // [11:52:03] [信息] 扫描 47 个文件
 *   const t = log.step('解析内容')                // 自动输出开始行
 *   t.end('解析作品 {0} 篇', 12)                  // [成功] 解析作品 12 篇（耗时 156ms）
 *   log.summary('构建摘要', [['作品', '12 篇'], ...])
 *
 * 规则：
 *   - 每行格式：[HH:MM:SS] [级别] 消息（级别：信息/成功/警告/错误/详细）
 *   - [详细] 仅在 verbose 模式输出
 *   - [错误] 自动置 process.exitCode = 1
 *   - 颜色仅在 TTY 且未设置 NO_COLOR 时启用（管道/重定向时输出纯文本）
 */

const LEVEL_TEXT = { info: '信息', ok: '成功', warn: '警告', error: '错误', debug: '详细' }

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}

const LEVEL_COLOR = { info: 'cyan', ok: 'green', warn: 'yellow', error: 'red', debug: 'gray' }

/** 是否启用 ANSI 颜色：TTY 输出且未禁色 */
function colorEnabled(stream) {
  return Boolean(stream && stream.isTTY) && !process.env.NO_COLOR
}

/** 当前时间 HH:MM:SS（本地时区） */
function timestamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 消息模板格式化：{n} 占位符替换为第 n 个参数。
 * 例：format('解析作品 {0} 篇 · 成语 {1} 条', 12, 20) → '解析作品 12 篇 · 成语 20 条'
 */
export function format(template, ...args) {
  return String(template ?? '').replace(/\{(\d+)\}/g, (m, i) => {
    const v = args[Number(i)]
    return v === undefined || v === null ? m : Array.isArray(v) ? v.join('·') : String(v)
  })
}

export function createLogger({ verbose = false, stream = process.stdout } = {}) {
  const useColor = colorEnabled(stream)
  const paint = (code, text) => (useColor ? `${ANSI[code]}${text}${ANSI.reset}` : text)

  const state = { errorCount: 0, warnCount: 0 }

  function write(level, template, ...args) {
    if (level === 'debug' && !verbose) return
    const tag = paint(LEVEL_COLOR[level], `[${LEVEL_TEXT[level]}]`)
    const time = paint('dim', `[${timestamp()}]`)
    const body = format(template, ...args)
    const line = `${time} ${tag} ${body}`
    stream.write(line + '\n')
    if (level === 'error') state.errorCount += 1
    if (level === 'warn') state.warnCount += 1
  }

  const logger = {
    /** 是否输出 [详细] 级别 */
    verbose,
    /** 错误累计数（用于构建管线决定退出码） */
    get errorCount() { return state.errorCount },
    /** 警告累计数 */
    get warnCount() { return state.warnCount },

    info(template, ...args) { write('info', template, ...args) },
    ok(template, ...args) { write('ok', template, ...args) },
    warn(template, ...args) { write('warn', template, ...args) },
    /** 输出错误日志并标记进程退出码为 1（不抛出、不中断流程） */
    error(template, ...args) {
      write('error', template, ...args)
      process.exitCode = 1
    },
    debug(template, ...args) { write('debug', template, ...args) },

    /**
     * 步骤计时器：开始时输出一行 [信息]，结束时输出 [成功] 并自动附上耗时毫秒。
     * 例：const t = log.step('构建图谱'); t.end('节点 {0} 个 · 关系边 {1} 条', 78, 120)
     *   → [11:52:03] [成功] 节点 78 个 · 关系边 120 条（耗时 42ms）
     */
    step(name) {
      const start = performance.now()
      this.info('开始 {0} …', name)
      return {
        /** 结束计时并输出成功行（自动追加（耗时 xms）） */
        end: (template, ...args) => {
          const ms = Math.max(1, Math.round(performance.now() - start))
          write('ok', '{0}（耗时 {1}ms）', format(template, ...args), ms)
          return ms
        },
        /** 结束计时并以警告级别输出（自动追加耗时） */
        endWarn: (template, ...args) => {
          const ms = Math.max(1, Math.round(performance.now() - start))
          write('warn', '{0}（耗时 {1}ms）', format(template, ...args), ms)
          return ms
        },
      }
    },

    /** 汇总块：以分隔线包裹的多行键值统计 */
    summary(title, rows) {
      const maxLabel = rows.reduce((m, [label]) => Math.max(m, visualWidth(label)), 0)
      const header = paint('bold', `── ${title} `) + paint('dim', '─'.repeat(Math.max(2, 46 - title.length * 2)))
      const lines = [header]
      for (const [label, value] of rows) {
        const pad = ' '.repeat(Math.max(1, maxLabel + 2 - visualWidth(label)))
        lines.push(`  ${label}${pad}${value}`)
      }
      lines.push(paint('dim', '─'.repeat(48)))
      stream.write(lines.join('\n') + '\n')
    },
  }

  return logger
}

/** 中文按 2 列宽估算，用于对齐 */
function visualWidth(text) {
  let w = 0
  for (const ch of String(text)) w += ch.charCodeAt(0) > 0xff ? 2 : 1
  return w
}

export default createLogger
