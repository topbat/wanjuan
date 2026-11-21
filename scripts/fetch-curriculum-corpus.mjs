#!/usr/bin/env node
/**
 * 万卷 · 课标导入语料按需获取工具
 *
 * 用途：从 chinese-poetry 开源语料库按需下载"课标 207 篇推荐背诵作品"导入所需的
 *      子集，落盘至 .vendor/chinese-poetry/（该目录已被 .gitignore 忽略）。
 *
 * 取数策略（按网络稳定性排序）：
 *   1. jsDelivr CDN 逐文件（对国内网络友好）：
 *      https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/<路径>
 *      注：data.jsdelivr.com 的整包目录树 API 对本仓库返回 403（超过 50MB 上限），
 *      故目录列表改用 GitHub contents API 获取。
 *   2. 失败回退 ghproxy 镜像（raw.githubusercontent.com）。
 *
 * 下载范围（课标导入所需，并非整库）：
 *   - 固定文件：曹操诗集 / 楚辞 / 论语 / 诗经 / 四书五经（大学·孟子·中庸）/
 *     元曲 / 蒙学（古文观止·千家诗·唐诗三百首）/ 全唐诗作者索引
 *   - 全唐诗：仅下载课标涉及作者对应的 poet.tang.*.json / poet.song.*.json
 *   - 宋词：全部 ci.song.*.json 分卷
 *   - 五代诗词：南唐二主词 / 花间集 全部文件
 *
 * 特性：已存在的文件自动跳过（可重复执行续传）；单文件失败重试后跳过并记录，
 *      不阻塞整体；全程中文结构化日志（scripts/lib/logger.mjs）。
 *
 * 用法：node scripts/fetch-curriculum-corpus.mjs [--verbose]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from './lib/logger.mjs'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const VENDOR = path.join(ROOT, '.vendor', 'chinese-poetry')

/** 文件下载源（依次回退）：jsDelivr CDN → ghproxy 镜像 */
const SOURCES = [
  (p) => `https://cdn.jsdelivr.net/gh/chinese-poetry/chinese-poetry@master/${encodeURI(p)}`,
  (p) => `https://mirror.ghproxy.com/https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/${encodeURI(p)}`,
]
const GH_API = 'https://api.github.com/repos/chinese-poetry/chinese-poetry/contents/'

const TIMEOUT_MS = 60_000
const RETRIES = 3
const CONCURRENCY = 6

const verbose = process.argv.includes('--verbose')
const log = createLogger({ verbose })

/** 固定清单：一次性整文件下载（相对仓库根路径） */
const FIXED_FILES = [
  '曹操诗集/caocao.json',
  '楚辞/chuci.json',
  '论语/lunyu.json',
  '诗经/shijing.json',
  '四书五经/daxue.json',
  '四书五经/mengzi.json',
  '四书五经/zhongyong.json',
  '元曲/yuanqu.json',
  '蒙学/guwenguanzhi.json',
  '蒙学/qianjiashi.json',
  '蒙学/tangshisanbaishou.json',
  '全唐诗/authors.tang.json',
  '全唐诗/authors.song.json',
]

/** 课标涉及的唐（含五代入唐集）诗人 → 全唐诗 poet.tang.*.json */
const NEEDED_TANG_AUTHORS = [
  '陈子昂', '贺知章', '骆宾王', '李峤', '王勃', '王昌龄', '王湾', '王之涣',
  '韦应物', '魏征', '温庭筠', '岑参', '崔颢', '胡令能',
  '贾岛', '李贺', '李商隐', '李绅', '刘禹锡', '柳宗元', '卢纶', '罗隐',
  '孟浩然', '孟郊', '白居易', '高适', '杜牧', '杜甫', '张继',
  '张若虚', '张志和',
]

/** 课标涉及的宋诗人 → 全唐诗 poet.song.*.json（该库唐宋诗同目录） */
const NEEDED_SONG_AUTHORS = [
  '曾几', '范成大', '范仲淹', '黄庭坚', '李清照', '林升',
  '刘克庄', '陆游', '苏轼', '苏辙',
  '王安石', '文天祥', '翁卷', '辛弃疾', '杨万里',
  '叶绍翁', '朱熹',
]

/**
 * 附加数据：OpenCC 繁→简字典（全唐诗/古文观止/四书五经/千家诗等分卷为繁体，
 * 导入脚本按此字典做 OpenCC 标准算法的最长匹配转换）。
 */
const OPENCC_FILES = [
  {
    rel: 'opencc/TSCharacters.txt',
    urls: [
      'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/TSCharacters.txt',
      'https://mirror.ghproxy.com/https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt',
    ],
  },
  {
    rel: 'opencc/TSPhrases.txt',
    urls: [
      'https://cdn.jsdelivr.net/gh/BYVoid/OpenCC@master/data/dictionary/TSPhrases.txt',
      'https://mirror.ghproxy.com/https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSPhrases.txt',
    ],
  },
]

// ─────────────────────────── 工具函数 ───────────────────────────

async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'wanjuan-fetch' } })
  } finally {
    clearTimeout(timer)
  }
}

/** 下载单个语料文件：多源回退 + 重试；成功返回 true */
async function fetchFile(rel) {
  const dest = path.join(VENDOR, rel)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log.debug('已存在，跳过：{0}', rel)
    return true
  }
  for (const mkUrl of SOURCES) {
    for (let i = 1; i <= RETRIES; i++) {
      try {
        const res = await fetchWithTimeout(mkUrl(rel))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length === 0) throw new Error('响应为空')
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, buf)
        log.debug('下载成功：{0}（{1} KB，第 {2} 源）', rel, (buf.length / 1024).toFixed(1), SOURCES.indexOf(mkUrl) + 1)
        return true
      } catch (err) {
        log.debug('下载失败：{0} 第 {1} 次尝试（{2}）', rel, i, err.message)
        await new Promise((r) => setTimeout(r, 500 * i))
      }
    }
  }
  return false
}

/** GitHub contents API 列目录（jsDelivr 整包树超 50MB 上限，改用此途径） */
async function listDir(dir) {
  const dest = path.join(VENDOR, '.listing', `${dir.replace(/\//g, '__')}.json`)
  if (fs.existsSync(dest)) return JSON.parse(fs.readFileSync(dest, 'utf8'))
  let res
  try {
    res = await fetchWithTimeout(GH_API + encodeURIComponent(dir), 30_000)
  } catch {
    res = null
  }
  if (!res || !res.ok) throw new Error(`目录列表获取失败：${dir}（HTTP ${res?.status ?? '网络错误'}）`)
  const arr = await res.json()
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(arr))
  return arr
}

/** 并发受限地批量下载，返回失败清单 */
async function fetchAll(files, label) {
  const failed = []
  let done = 0
  const queue = [...files]
  async function worker() {
    while (queue.length) {
      const rel = queue.shift()
      const ok = await fetchFile(rel)
      if (!ok) failed.push(rel)
      done += 1
      if (done % 10 === 0 || done === files.length) {
        log.info('{0}：{1}/{2}', label, done, files.length)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker))
  return failed
}

/**
 * 解析全唐诗作者索引（authors.*.json 数组，元素含 name/desc/id）为 名字 → 序号 映射。
 * 注：分卷文件（poet.tang.N.json / poet.song.N.json）按该数组顺序每 1000 首连续切分，
 *     故序号可用于二分定位目标作者所在分卷。
 */
function buildAuthorIndex(arr) {
  const index = new Map()
  arr.forEach((entry, i) => {
    const name = typeof entry === 'string' ? entry : entry?.name ?? entry?.title
    if (name && !index.has(name)) index.set(name, i)
  })
  return index
}

/** 加载 OpenCC 单字繁→简映射（authors.song.json 等为繁体，需转简后比对） */
function loadCharMap() {
  const file = path.join(VENDOR, 'opencc', 'TSCharacters.txt')
  if (!fs.existsSync(file)) return new Map()
  const map = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const [t, s] = line.split('\t')
    if (t && s && !map.has(t)) map.set(t, s)
  }
  return map
}
function toSimplified(text, map) {
  return [...String(text)].map((ch) => map.get(ch) ?? ch).join('')
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  log.info('万卷课标语料获取启动（jsDelivr CDN → ghproxy 回退）')
  if (verbose) log.debug('落盘目录：{0}', VENDOR)
  fs.mkdirSync(VENDOR, { recursive: true })
  const allFailed = []

  // 1. 固定文件
  const fixedStep = log.step('下载固定语料文件')
  allFailed.push(...(await fetchAll(FIXED_FILES, '固定文件')))
  fixedStep.end(
    '固定文件完成：成功 {0}/{1}',
    FIXED_FILES.length - allFailed.length, FIXED_FILES.length,
  )
  const criticalMissed = FIXED_FILES.filter((f) => allFailed.includes(f))
  if (criticalMissed.length) {
    log.error('关键语料缺失：{0}', criticalMissed.join('、'))
  }

  // 2. 宋词分卷 + 五代诗词子目录（动态列目录）
  const dirStep = log.step('列取并下载 宋词/五代诗词 分卷')
  try {
    const [ciDir, nantang, huajianji] = await Promise.all([
      listDir('宋词'), listDir('五代诗词/nantang'), listDir('五代诗词/huajianji'),
    ])
    const ciFiles = ciDir.filter((f) => f.type === 'file' && /^ci\.song\.[\w.]+\.json$/.test(f.name)).map((f) => `宋词/${f.name}`)
    const wdFiles = [
      ...nantang.filter((f) => f.type === 'file').map((f) => `五代诗词/nantang/${f.name}`),
      ...huajianji.filter((f) => f.type === 'file').map((f) => `五代诗词/huajianji/${f.name}`),
    ]
    log.info('宋词分卷 {0} 个 · 南唐二主词 {1} 个 · 花间集 {2} 个', ciFiles.length,
      wdFiles.length - huajianji.filter((f) => f.type === 'file').length,
      huajianji.filter((f) => f.type === 'file').length)
    const failed = await fetchAll([...ciFiles, ...wdFiles], '词卷下载')
    allFailed.push(...failed)
    dirStep.end('词卷下载完成：失败 {0} 个', failed.length)
  } catch (err) {
    dirStep.endWarn('词卷目录列取失败：{0}', err.message)
  }

  // 3. 全唐诗：唐诗分卷全量下载（58 个，唐作者覆盖最全）；
  //    宋诗分卷体积巨大（255 个），按 authors.song.json 顺序二分探测定位目标作者所在卷
  const poetStep = log.step('下载全唐诗分卷（唐全量 · 宋定向）')
  try {
    const tangList = (await listDir('全唐诗')).filter((f) => f.type === 'file' && /^poet\.tang\.\d+\.json$/.test(f.name)).map((f) => `全唐诗/${f.name}`)
    const failedTang = await fetchAll(tangList, '唐诗分卷')
    allFailed.push(...failedTang)
    log.info('唐诗分卷完成：{0} 个 · 失败 {1} 个', tangList.length, failedTang.length)

    const songAuthors = JSON.parse(fs.readFileSync(path.join(VENDOR, '全唐诗/authors.song.json'), 'utf8'))
    const ccMap = loadCharMap()
    const songPos = new Map(songAuthors.map((a, i) => [toSimplified(a.name ?? a.title ?? a, ccMap), i]))
    const songList = (await listDir('全唐诗')).filter((f) => f.type === 'file' && /^poet\.song\.\d+\.json$/.test(f.name))
      .map((f) => ({ rel: `全唐诗/${f.name}`, n: Number(f.name.match(/\d+/)[0]) }))
      .sort((a, b) => a.n - b.n)
    const targets = []
    const missingSong = []
    for (const name of NEEDED_SONG_AUTHORS) {
      const pos = songPos.get(name)
      if (pos == null) missingSong.push(name); else targets.push({ name, pos })
    }
    if (missingSong.length) log.warn('宋作者索引未命中：{0}', missingSong.join('、'))

    /** 读取某宋诗分卷首条作者在 authors.song.json 中的序号（分卷按该序连续切分） */
    const firstPosCache = new Map()
    async function firstPosOf(idx) {
      if (firstPosCache.has(idx)) return firstPosCache.get(idx)
      const rel = songList[idx].rel
      const dest = path.join(VENDOR, rel)
      if (!fs.existsSync(dest)) await fetchFile(rel)
      const arr = JSON.parse(fs.readFileSync(dest, 'utf8'))
      const pos = songPos.get(toSimplified(arr[0]?.author ?? '', ccMap))
      firstPosCache.set(idx, pos ?? -1)
      return pos ?? -1
    }
    /** 二分：返回首作者序号不超过 pos 的最后一个分卷下标 */
    async function locate(pos) {
      let lo = 0, hi = songList.length - 1, ans = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const fp = await firstPosOf(mid)
        if (fp <= pos) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      return ans
    }
    const songRels = new Set()
    for (const t of targets) {
      const i = await locate(t.pos)
      songRels.add(songList[i].rel)
      if (i + 1 < songList.length) songRels.add(songList[i + 1].rel) // 跨卷保险
    }
    const failedSong = await fetchAll([...songRels], '宋诗分卷')
    allFailed.push(...failedSong)
    poetStep.end(
      '唐诗 {0}/{1} · 宋诗定向 {2} 个（覆盖作者 {3} 位，失败 {4}）',
      tangList.length - failedTang.length, tangList.length, songRels.size,
      targets.length, failedSong.length,
    )
  } catch (err) {
    poetStep.endWarn('诗人分卷跳过：{0}', err.message)
  }

  // 4. OpenCC 繁→简字典（部分语料为繁体，导入时转换）
  const ccStep = log.step('下载 OpenCC 繁简字典')
  let ccFailed = 0
  for (const f of OPENCC_FILES) {
    const dest = path.join(VENDOR, f.rel)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { log.debug('已存在，跳过：{0}', f.rel); continue }
    let ok = false
    for (const url of f.urls) {
      for (let i = 1; i <= RETRIES && !ok; i++) {
        try {
          const res = await fetchWithTimeout(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.writeFileSync(dest, buf)
          ok = true
        } catch (err) {
          log.debug('下载失败：{0}（{1}）', f.rel, err.message)
          await new Promise((r) => setTimeout(r, 500 * i))
        }
      }
      if (ok) break
    }
    if (!ok) ccFailed += 1
  }
  ccFailed ? ccStep.endWarn('OpenCC 字典缺 {0} 个文件', ccFailed) : ccStep.end('OpenCC 字典就绪（2 个文件）')
  if (ccFailed) allFailed.push('opencc/TS*.txt')

  // 5. 汇总
  const totalFiles = fs.readdirSync(VENDOR, { recursive: true })
    .filter((f) => String(f).endsWith('.json') && !String(f).includes('.listing') && fs.statSync(path.join(VENDOR, String(f))).size > 0).length
  log.summary('语料获取摘要', [
    ['落盘目录', '.vendor/chinese-poetry/'],
    ['JSON 文件数', `${totalFiles} 个`],
    ['失败清单', allFailed.length ? allFailed.join('、') : '无'],
    ['结果', allFailed.length === 0 ? '全部成功' : '部分失败，可重跑续传'],
  ])
  if (allFailed.length || criticalMissed.length) process.exitCode = 1
}

main().catch((err) => {
  log.error('语料获取异常终止：{0}', err?.stack || err?.message || err)
  process.exit(1)
})
