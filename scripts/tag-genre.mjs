#!/usr/bin/env node
/**
 * 万卷 · 题材规则标注
 *
 * 目标：为 content/poems 下 genre 为「待归类」或缺失的作品做可解释的规则标注，
 *       只写入 confidence ≥ medium 的结果；low 或并列第一保持「待归类」。
 *
 * 标注依据（优先级从高到低）：
 *   1. frontmatter 既有标签（tags 含「边塞」「咏史」等直接采信）
 *   2. 标题关键词（送/别/赠 → 送别；登/望/题 + 山/楼/湖 → 山水；咏/赋得 → 咏物……）
 *   3. 正文特征词（每题材 8-20 个，命中 ≥2 个才计分，特征词带权重）
 *   4. 体裁先验（form 含「文」走散文枚举；「词」「曲」不直接定题材）
 *
 * 计分：score = 正文命中特征词权重和 + 标题命中 2 分
 *       confidence = high（≥4）/ medium（2-3）/ low（1）
 *       四时/论说若无标题明示，最高 medium（避免仅凭泛词给出高置信）
 *       并列第一 → 不写；正文命中不足 2 个特征词 → 正文不计分。
 *
 * 安全约束：
 *   - 已有人工 genre（非「待归类」）绝不覆盖，只补 genre_source: manual。
 *   - 写入采用「只改 genre 相关行」的方式，保留其余 frontmatter 与正文原样。
 *
 * 用法：
 *   node scripts/tag-genre.mjs [--verbose] [--force] [--dry-run]
 *     --force    重新评估已由本工具标注（genre_source: auto）的作品；人工标注永不动
 *     --dry-run  只统计与输出报告，不写 md / docs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'
import matter from 'gray-matter'
import { createLogger } from './lib/logger.mjs'

// ─────────────────────────── 常量与路径 ───────────────────────────

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const POEM_DIR = path.join(ROOT, 'content', 'poems')
const DOCS_DIR = path.join(ROOT, 'docs')
const DOC_PATH = path.join(DOCS_DIR, 'genre-review.md')

const POETRY_GENRES = [
  '思乡', '送别', '边塞', '山水', '田园', '咏物', '咏史怀古', '哲理', '家国',
  '爱情', '闺怨', '悼亡', '励志', '讽喻', '叙事', '闲适', '四时', '干谒',
]
const PROSE_GENRES = ['论说', '史传', '书序', '游记', '奏议', '寓言', '辞赋']
const ALL_GENRES = new Set([...POETRY_GENRES, ...PROSE_GENRES])

const UNCLASSIFIED = '待归类'
const HIGH_THRESHOLD = 4
const MEDIUM_THRESHOLD = 2

const verbose = process.argv.includes('--verbose')
const force = process.argv.includes('--force')
const dryRun = process.argv.includes('--dry-run')
const log = createLogger({ verbose })

// ─────────────────────────── 特征词表（每题材 8-20 个，权重 1/2/4） ───────────────────────────
// 权重约定：2 = 题材专指词；1 = 通用但有效的意象/语汇；4 = 近乎唯一的短语。

const LEXICONS = {
  // ── 诗歌题材 ──
  思乡: [
    ['故乡', 3], ['故园', 3], ['乡书', 3], ['乡关', 3], ['乡音', 3], ['归雁', 3],
    ['客路', 3], ['旅', 2], ['思亲', 2], ['游子', 2], ['回乡', 2], ['愁眠', 2],
    ['作客', 2], ['悲秋', 2], ['烟波', 2], ['明月', 3], ['归', 1], ['客', 1],
    ['日暮', 1], ['还', 1],
  ],
  送别: [
    ['送', 2], ['别', 2], ['离', 2], ['故人', 2], ['知己', 2], ['阳关', 2],
    ['渭城', 2], ['沾巾', 2], ['歧路', 2], ['西出', 2], ['西辞', 2], ['踏歌', 2],
    ['桃花潭', 2], ['亲友', 2], ['客舍', 1], ['柳', 1], ['酒', 1], ['君', 1],
    ['孤帆', 1], ['一杯', 1],
  ],
  边塞: [
    ['塞', 2], ['羌笛', 2], ['羌管', 2], ['胡天', 2], ['胡马', 2], ['胡骑', 2],
    ['单于', 2], ['大漠', 2], ['瀚海', 2], ['燕然', 2], ['阴山', 2], ['玉门', 2],
    ['楼兰', 2], ['沙场', 2], ['铁衣', 2], ['征夫', 2], ['都护', 2], ['轮台', 2],
    ['征战', 2], ['角声', 2],
  ],
  山水: [
    ['山', 1], ['水', 1], ['江', 1], ['河', 1], ['湖', 1], ['海', 1], ['云', 1],
    ['峰', 2], ['岭', 2], ['瀑布', 2], ['泉', 2], ['涧', 2], ['溪', 2], ['潭', 2],
    ['舟', 1], ['帆', 1], ['黄河', 2], ['波', 1], ['深林', 2], ['万重山', 2],
  ],
  田园: [
    ['桑', 2], ['麻', 2], ['锄', 2], ['篱', 2], ['耕', 2], ['田', 2], ['农', 2],
    ['蚕', 2], ['鸡豚', 2], ['腊酒', 2], ['春社', 2], ['插田', 2], ['耘田', 2],
    ['绩麻', 2], ['种瓜', 2], ['桑阴', 2], ['麦花', 2], ['菜花', 2], ['茅檐', 2],
    ['茆檐', 2],
  ],
  咏物: [
    ['似', 1], ['如', 1], ['妆', 2], ['裁', 2], ['采得', 2], ['成蜜', 2],
    ['白毛', 2], ['红掌', 2], ['曲项', 2], ['碧玉', 2], ['绿丝绦', 2], ['细叶', 2],
    ['剪刀', 2], ['解落', 2], ['能开', 2], ['千尺浪', 2], ['万竿斜', 2],
    ['白玉盘', 2], ['瑶台镜', 2], ['桂树', 2],
  ],
  咏史怀古: [
    ['怀古', 2], ['千古', 2], ['兴亡', 2], ['前朝', 2], ['故国', 2], ['六朝', 2],
    ['英雄', 2], ['周郎', 2], ['丞相', 2], ['祠堂', 2], ['出师', 2], ['遗曲', 2],
    ['后庭', 2], ['折戟', 2], ['铜雀', 2], ['古人', 2], ['项羽', 2], ['鬼雄', 2],
    ['杜郎', 2], ['废池', 2],
  ],
  哲理: [
    ['不识', 2], ['只缘', 2], ['问渠', 2], ['源头', 2], ['活水', 2], ['不畏', 2],
    ['最高层', 2], ['浮云', 2], ['一岁一枯荣', 2], ['代代', 2], ['无穷', 2],
    ['相似', 2], ['人生', 1], ['山重水复', 2], ['柳暗花明', 2], ['真面目', 2],
    ['无可奈何', 2], ['几时回', 2], ['江月', 2], ['何人', 2],
  ],
  家国: [
    ['故国', 2], ['山河', 2], ['九州', 2], ['天下', 1], ['王师', 2], ['丹心', 2],
    ['汗青', 2], ['中原', 2], ['君王', 2], ['寒士', 2], ['皇舆', 2], ['广厦', 2],
    ['干戈', 2], ['破碎', 2], ['国脉', 2], ['戎主', 2], ['长安', 3], ['行人泪', 3],
    ['雕栏玉砌', 2], ['美政', 2],
  ],
  爱情: [
    ['伊人', 2], ['淑女', 2], ['窈窕', 2], ['寤寐', 2], ['君子', 1], ['相思', 2],
    ['两情', 2], ['佳期', 2], ['春蚕', 2], ['蜡炬', 2], ['共剪', 2], ['西窗', 2],
    ['红烛', 2], ['青鸟', 2], ['蓬山', 2], ['此情', 2], ['在水一方', 2], ['溯洄', 2],
    ['云鬓', 2], ['丝', 1],
  ],
  闺怨: [
    ['闺', 2], ['妆', 2], ['蛾眉', 2], ['梳洗', 2], ['罗襦', 2], ['独守', 2],
    ['窗儿', 1], ['憔悴', 1], ['相思', 2], ['望夫', 2], ['春闺', 2], ['懒起', 2],
    ['嬾起', 2], ['弄妆', 2], ['花面', 2], ['双', 2], ['泪', 1], ['愁', 1],
    ['红颜', 1], ['玉容', 1],
  ],
  悼亡: [
    ['十年生死', 2], ['孤坟', 2], ['千里孤坟', 2], ['记梦', 2], ['短松冈', 2],
    ['相顾无言', 2], ['亡', 1], ['泪', 1], ['肠断', 1], ['明月夜', 1], ['鬓如霜', 1],
    ['小轩窗', 1], ['梳妆', 1], ['幽梦', 1], ['还乡', 1], ['不思量', 1],
    ['自难忘', 1], ['尘满面', 1], ['年年', 1], ['断肠', 1],
  ],
  励志: [
    ['长风破浪', 4], ['会有时', 2], ['天生我材', 2], ['千金散尽', 2], ['壮志', 2],
    ['努力', 1], ['少壮', 1], ['鹏', 2], ['九万里', 2], ['老骥', 1], ['千里', 1],
    ['长精神', 2], ['沉舟', 2], ['病树', 2], ['万木春', 2], ['天下归心', 2],
    ['周公吐哺', 2], ['山不厌高', 2], ['直挂云帆', 2], ['济沧海', 2],
  ],
  讽喻: [
    ['谁知', 2], ['盘中餐', 2], ['饿死', 2], ['亡国恨', 2], ['商女', 2], ['犹唱', 2],
    ['后庭花', 2], ['歌舞', 2], ['几时休', 2], ['直把杭州作汴州', 2],
    ['为谁辛苦', 2], ['为谁甜', 2], ['风波里', 2], ['一叶舟', 1], ['寒士', 2],
    ['百姓', 2], ['鲈鱼', 2], ['出没', 2], ['农夫犹饿死', 4], ['粒粒皆辛苦', 4],
  ],
  叙事: [
    ['忽闻', 2], ['移船', 2], ['千呼万唤', 2], ['曲终', 2], ['自言', 2], ['借问', 1],
    ['遥招手', 1], ['童子', 1], ['言师', 2], ['采药', 2], ['儿童相见', 2], ['笑问', 1],
    ['偶书', 2], ['门前', 1], ['老大', 1], ['嫁作', 1], ['商人', 1], ['弹', 1],
    ['琵琶', 1], ['寻', 1],
  ],
  闲适: [
    ['闲', 2], ['悠然', 2], ['独坐', 2], ['垂钓', 2], ['渔', 2], ['酒', 1], ['樽', 1],
    ['醉', 1], ['卧', 1], ['竹', 1], ['松', 1], ['自得', 2], ['无事', 2], ['小园', 2],
    ['独步', 2], ['寻花', 1], ['客至', 2], ['群鸥', 1], ['邻翁', 2], ['白鸥盟', 2],
  ],
  四时: [
    ['春', 1], ['秋', 1], ['雪', 2], ['霜', 2], ['露', 1], ['雨', 1], ['花', 1],
    ['柳', 1], ['早莺', 2], ['新燕', 2], ['荷', 2], ['清明', 2], ['元日', 2],
    ['元夕', 2], ['中秋', 2], ['重阳', 2], ['茱萸', 2], ['爆竹', 2], ['红杏', 2],
    ['河豚', 2],
  ],
  干谒: [
    ['干谒', 2], ['谒', 2], ['呈', 2], ['投赠', 2], ['求见', 2], ['引荐', 2], ['荐', 2],
    ['韩荆州', 2], ['韩太尉', 2], ['相公', 1], ['门下', 1], ['仕进', 2], ['功名', 1],
    ['拜谒', 2], ['自荐', 2], ['求知', 2], ['举荐', 2], ['恩公', 1], ['大人', 1],
    ['执事', 1],
  ],

  // ── 文言/散文题材 ──
  论说: [
    ['曰', 1], ['舍生取义', 2], ['何以', 2], ['何谓', 2], ['可谓', 2], ['是以', 2],
    ['义', 2], ['仁', 2], ['礼', 2], ['君子', 2], ['师', 2], ['道', 1], ['修身', 2],
    ['齐家', 2], ['治国', 2], ['格物', 2], ['德馨', 2], ['何陋之有', 2], ['六国', 2],
    ['赂', 2],
  ],
  史传: [
    ['传', 2], ['列传', 2], ['世家', 1], ['太史公', 2], ['左丘明', 2], ['离骚', 2],
    ['战', 2], ['伐', 2], ['齐师', 2], ['公', 1], ['诸侯', 2], ['纳谏', 2], ['既克', 2],
    ['朝', 2], ['乃', 1], ['传其事', 2], ['屈平', 2], ['怀王', 2], ['齐王', 2],
    ['群臣', 2],
  ],
  书序: [
    ['序', 2], ['集序', 2], ['宴集', 2], ['群贤', 2], ['少长', 2], ['修禊', 2],
    ['流觞', 2], ['曲水', 2], ['属予作文', 2], ['诗赋', 2], ['文集', 2], ['兰亭', 2],
    ['滕王阁', 2], ['胜友', 2], ['高朋', 2], ['盛筵', 2], ['胜地', 2], ['斯文', 2],
    ['作序', 2], ['序言', 2],
  ],
  游记: [
    ['游', 2], ['记', 1], ['山', 1], ['水', 1], ['亭', 2], ['楼', 2], ['溪', 2],
    ['行', 1], ['望', 1], ['见', 1], ['环滁', 2], ['林壑', 2], ['峰回路转', 2],
    ['泛舟', 2], ['石钟', 2], ['竹楼', 2], ['岳阳楼', 2], ['桃花源', 2],
    ['豁然开朗', 2], ['良田美池', 2],
  ],
  奏议: [
    ['臣', 2], ['陛下', 2], ['上疏', 2], ['谏', 2], ['表', 2], ['疏', 2], ['伏惟', 2],
    ['愚以为', 2], ['窃以为', 2], ['乞', 2], ['陈情', 2], ['拜表', 2], ['圣听', 2],
    ['朝廷', 1], ['逐客', 2], ['十思', 2], ['陈', 1], ['闻', 1], ['谨', 1], ['愿', 1],
  ],
  寓言: [
    ['寓言', 2], ['寓', 2], ['托', 1], ['喻', 2], ['讽', 2], ['借', 1], ['故事', 1],
    ['种树', 2], ['郭橐驼', 2], ['顺木之天', 2], ['其乡', 1], ['传其事', 2],
    ['以为戒', 2], ['寓意', 2], ['假托', 2], ['拟人', 2], ['道理', 1], ['戒', 2],
    ['讽喻', 2], ['寄托', 2],
  ],
  辞赋: [
    ['赋', 2], ['兮', 2], ['楚辞', 2], ['离骚', 2], ['铺陈', 2], ['骈', 2], ['四六', 2],
    ['主客', 2], ['问答', 1], ['阿房', 2], ['赤壁', 2], ['六王毕', 2], ['壬戌', 2],
    ['苏子', 2], ['客曰', 2], ['歌曰', 2], ['桂棹', 2], ['兰桨', 2], ['香草', 2],
    ['美人', 1],
  ],
}

// 特征词表合法性自检：8-20 个，且没有重复词
for (const [genre, entries] of Object.entries(LEXICONS)) {
  if (!ALL_GENRES.has(genre)) throw new Error(`未知题材：${genre}`)
  if (entries.length < 8 || entries.length > 20) {
    throw new Error(`题材「${genre}」特征词数量为 ${entries.length}，应在 8-20 之间`)
  }
  const words = new Set(entries.map(([w]) => w))
  if (words.size !== entries.length) throw new Error(`题材「${genre}」特征词有重复`)
}

// ─────────────────────────── 标题规则 ───────────────────────────

/** 返回命中的标题片段（用于依据展示），未命中返回 null */
const TITLE_RULES = {
  思乡: [(t) => t.match(/回乡|乡思|乡愁/)?.[0] ?? null],
  送别: [
    (t) => t.match(/送|别|饯|留别/)?.[0] ?? null,
    // “赠”多为赠别/赠友；酬赠、见赠属于唱和，排除
    (t) => (t.includes('赠') && !/见赠|酬/.test(t) ? '赠' : null),
  ],
  边塞: [(t) => t.match(/塞|凉州|燕歌|雁门|从军|关山|出塞/)?.[0] ?? null],
  山水: [(t) => t.match(/山|水|湖|江|河|海|涧|溪|潭|池|瀑布|峰|岭|楼|阁|台|亭/)?.[0] ?? null],
  田园: [(t) => t.match(/田园|村|农|桑|耕|锄|田|禾/)?.[0] ?? null],
  咏物: [
    (t) => t.match(/^咏|^赋得/)?.[0] ?? null,
    (t) => (/(月)/.test(t) || /^(风|蜂|鹅|柳|雪|梅|竹|菊|莲|荷|雁|蝉)$/.test(t) ? t.match(/月|风|蜂|鹅|柳|雪|梅|竹|菊|莲|荷|雁|蝉/)?.[0] ?? null : null),
  ],
  咏史怀古: [(t) => t.match(/怀古|咏史|金陵|赤壁|蜀相|京口|北固|潼关|幽州台|项羽|六国/)?.[0] ?? null],
  哲理: [(t) => t.match(/观书|题西林壁|登鹳雀楼/)?.[0] ?? null],
  家国: [(t) => t.match(/示儿|过零丁洋|春望/)?.[0] ?? null],
  爱情: [(t) => t.match(/关雎|蒹葭|鹊桥仙|无题|夜雨寄北/)?.[0] ?? null],
  闺怨: [(t) => t.match(/闺怨|春闺|望夫/)?.[0] ?? null],
  悼亡: [(t) => t.match(/江城子|记梦/)?.[0] ?? null],
  励志: [(t) => t.match(/行路难|将进酒|短歌行/)?.[0] ?? null],
  讽喻: [(t) => t.match(/悯/)?.[0] ?? null],
  叙事: [(t) => t.match(/琵琶行|小儿垂钓|寻隐者不遇|偶书/)?.[0] ?? null],
  闲适: [(t) => t.match(/渔歌子|客至|独步寻花|饮酒/)?.[0] ?? null],
  四时: [(t) => t.match(/春|秋|冬|雪|清明|元日|元夕|七夕|中秋|重阳|寒食/)?.[0] ?? null],
  干谒: [(t) => t.match(/干谒|投赠|自荐/)?.[0] ?? null],

  论说: [(t) => t.match(/论|说|中庸|大学|《论语》|《孟子》|《礼记》/)?.[0] ?? null],
  史传: [(t) => t.match(/传|世家|列传/)?.[0] ?? null],
  书序: [(t) => t.match(/序/)?.[0] ?? null],
  游记: [(t) => t.match(/记/)?.[0] ?? null],
  奏议: [(t) => t.match(/表$|疏$|^谏/)?.[0] ?? null],
  寓言: [(t) => t.match(/寓言/)?.[0] ?? null],
  辞赋: [(t) => t.match(/赋/)?.[0] ?? null],
}

/** 标题得分生效所需的最少正文命中数（避免标题单点误判） */
const TITLE_MIN_BODY_HITS = { 山水: 2, 咏物: 2, 四时: 1 }

/** 必须命中标题才参与判定的题材 */
const TITLE_REQUIRED = new Set(['游记'])

/** 送别：无标题命中时，正文至少要有 1 个“送别场景”专指词，避免「别是一般滋味」误判 */
const FAREWELL_SPECIFIC = new Set([
  '故人', '知己', '阳关', '渭城', '沾巾', '歧路', '西出', '西辞', '踏歌', '桃花潭',
  '亲友', '客舍', '柳', '酒', '君', '孤帆', '一杯',
])

/** 曲牌名后的正文标题（「山坡羊·潼关怀古」→「潼关怀古」），避免曲牌里的「山」「水」误命中 */
function titleForRules(title) {
  const index = String(title).indexOf('·')
  return index >= 0 ? String(title).slice(index + 1) : String(title)
}

/** 标题明示某类文体/主题时的排他规则 */
function suppressedGenres(title) {
  const t = titleForRules(title)
  const suppressed = new Set()
  // 标题含「怀古/咏史」：以咏史怀古为主，不再按山水/四时/田园取景判类
  if (/怀古|咏史/.test(t)) {
    suppressed.add('山水')
    suppressed.add('四时')
    suppressed.add('田园')
  }
  // 标题以「论/说」结尾：论说文，排除史传（过秦论、六国论等常夹叙史事）
  if (/[论说](（[^）]*）)?$/.test(t)) suppressed.add('史传')
  // 标题以「序」结尾：书序，排除史传/游记/论说
  if (/序$/.test(t)) {
    suppressed.add('史传')
    suppressed.add('游记')
    suppressed.add('论说')
  }
  // 标题以「赋」结尾：辞赋
  if (/赋$/.test(t)) {
    suppressed.add('游记')
    suppressed.add('论说')
  }
  // 标题以「书」结尾：书信，非史传/辞赋；非「谏…书」的私信也不按奏议处理
  if (/书$/.test(t)) {
    suppressed.add('史传')
    if (!/^谏/.test(t)) {
      suppressed.add('奏议')
      suppressed.add('辞赋')
    }
  }
  // 题壁/书壁诗：不以标题中的地名（如「湖阴」含「湖」）判山水
  if (/^书.*壁$/.test(t)) suppressed.add('山水')
  return suppressed
}

/** tags → 题材（优先级最高，直接采信） */
const TAG_GENRE_MAP = {
  思乡: '思乡', 送别: '送别', 边塞: '边塞', 边塞诗: '边塞', 山水: '山水',
  田园: '田园', 咏物: '咏物', 咏史: '咏史怀古', 怀古: '咏史怀古', 咏史怀古: '咏史怀古',
  哲理: '哲理', 家国: '家国', 爱情: '爱情', 闺怨: '闺怨', 悼亡: '悼亡', 励志: '励志',
  讽喻: '讽喻', 叙事: '叙事', 闲适: '闲适', 四时: '四时', 四季: '四时', 干谒: '干谒',
  咏山: '山水', 咏水: '山水', 论说: '论说', 史传: '史传', 书序: '书序', 游记: '游记',
  奏议: '奏议', 寓言: '寓言', 辞赋: '辞赋',
}

/** 作者/出处先验（散文） */
const AUTHOR_PRIOR = {
  '《左传》': '史传',
  '《战国策》': '史传',
  '《史记》': '史传',
  '《论语》': '论说',
  '《孟子》': '论说',
  '《礼记》': '论说',
}

// ─────────────────────────── 工具函数 ───────────────────────────

/** 正文「## 原文」区块（去掉引用与后续小节） */
function extractOriginal(content) {
  const afterHeading = content.split(/^##\s*原文\s*$/m)[1]
  const scope = afterHeading ?? content
  return scope
    .split(/^##\s+/m)[0]
    .split(/^>\s?/m)[0]
    .replace(/\r/g, '')
    .trim()
}

/** 去掉标点空白，用于宽松匹配（保留汉字/字母/数字） */
function compact(text) {
  return String(text).replace(/[\s，。！？、；：,.!?;:「」『』“”"'（）()《》〈〉·—\-…]/g, '')
}

/** 命中特征词：返回 [{word, weight}]，同一词只计一次 */
function hitKeywords(text, entries) {
  const hits = []
  const source = compact(text)
  for (const [word, weight] of entries) {
    if (source.includes(compact(word))) hits.push({ word, weight })
  }
  return hits
}

/** 标题命中：返回 [{word}] */
function hitTitle(title, genre) {
  const rules = TITLE_RULES[genre] ?? []
  const hits = []
  for (const rule of rules) {
    const word = rule(title)
    if (word && !hits.some((h) => h.word === word)) hits.push({ word })
  }
  return hits
}

function isProse(form) {
  return /文/.test(form ?? '')
}

/**
 * 为单篇作品打分。
 * @returns {{ candidates: Array, best: object|null, tie: boolean }}
 */
function scorePoem({ title, form, body }) {
  const genres = isProse(form) ? PROSE_GENRES : POETRY_GENRES
  const ruleTitle = titleForRules(title)
  const suppressed = suppressedGenres(title)
  const candidates = []
  const lowCandidates = []
  for (const genre of genres) {
    if (suppressed.has(genre)) continue
    const bodyHits = hitKeywords(body, LEXICONS[genre])
    const titleHits = hitTitle(ruleTitle, genre)

    // 游记必须由标题「记」触发；山水无标题时需至少 1 个强特征词（峰/岭/泉/涧/溪/潭…）
    if (TITLE_REQUIRED.has(genre) && !titleHits.length) continue
    if (genre === '山水' && !titleHits.length && !bodyHits.some((h) => h.weight >= 2)) continue
    if (genre === '送别' && !titleHits.length && !bodyHits.some((h) => FAREWELL_SPECIFIC.has(h.word))) continue
    // 四时无标题季节词时，正文至少要有 1 个强季节词（雪/霜/荷/节日/时令花木）
    if (genre === '四时' && !titleHits.length && !bodyHits.some((h) => h.weight >= 2)) continue

    let bodyScore = bodyHits.length >= 2 ? bodyHits.reduce((sum, h) => sum + h.weight, 0) : 0
    const minBody = TITLE_MIN_BODY_HITS[genre]
    const titleAllowed = titleHits.length && (minBody === undefined || bodyHits.length >= minBody)
    const titleScore = titleAllowed ? 2 : 0
    const score = bodyScore + titleScore
    if (score > 0) {
      candidates.push({
        genre, score, bodyHits, titleHits, bodyScore, titleScore,
        // 无标题明示时，四时/论说的把握较低，最高给 medium
        capMedium: (genre === '四时' || genre === '论说') && !titleHits.length,
      })
    } else if (!titleHits.length && bodyHits.length === 1) {
      // low：仅 1 个正文特征词，不写入，但在报告里列出候选
      lowCandidates.push({
        genre, score: 1, bodyHits, titleHits, bodyScore: 0, titleScore: 0, low: true,
      })
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.bodyHits.length - a.bodyHits.length)
  lowCandidates.sort(
    (a, b) => (b.bodyHits[0]?.weight ?? 0) - (a.bodyHits[0]?.weight ?? 0)
      || a.genre.localeCompare(b.genre, 'zh'),
  )
  const best = candidates[0] ?? null
  const tie = Boolean(best && candidates[1] && candidates[1].score === best.score)
  return { candidates, best, tie, lowCandidates }
}

/** 生成可读依据 */
function buildRule(candidate) {
  const parts = []
  if (candidate.titleHits.length) {
    parts.push(`标题「${candidate.titleMatch}」`)
  }
  if (candidate.bodyHits.length) {
    const words = candidate.bodyHits.slice(0, 6).map((h) => h.word)
    const more = candidate.bodyHits.length > 6 ? ' 等' : ''
    parts.push(`关键词 ${words.join('/')}${more}`)
  }
  return parts.join(' + ')
}

/** YAML 标量安全输出 */
function yamlScalar(value) {
  const text = String(value).replace(/\r?\n/g, ' ').trim()
  if (!text) return '""'
  if (/^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(text) || /:\s| #/.test(text)) return JSON.stringify(text)
  return text
}

/**
 * 只改 frontmatter 的 genre 相关行。
 * @param {string} raw 原文件
 * @param {{genre?: string, source?: string, confidence?: string|null, rule?: string|null}} fields
 */
function patchFrontmatter(raw, fields) {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const rest = bom ? raw.slice(1) : raw
  const match = rest.match(/^---(\r?\n)([\s\S]*?)(\r?\n)---(?=\r?\n|$)/)
  if (!match) throw new Error('未找到 frontmatter')
  const eol = match[1]
  let lines = match[2].split(eol)

  // 删除本工具维护的字段，稍后按固定顺序重建
  for (const key of ['genre_source', 'genre_confidence', 'genre_rule']) {
    lines = lines.filter((line) => !new RegExp(`^${key}\\s*:`).test(line))
  }

  const genreIndex = lines.findIndex((line) => /^genre\s*:/.test(line))
  const extra = []
  if (fields.source) extra.push(`genre_source: ${yamlScalar(fields.source)}`)
  if (fields.confidence) extra.push(`genre_confidence: ${yamlScalar(fields.confidence)}`)
  if (fields.rule) extra.push(`genre_rule: ${yamlScalar(fields.rule)}`)

  if (genreIndex >= 0) {
    if (fields.genre !== undefined) lines[genreIndex] = `genre: ${yamlScalar(fields.genre)}`
    lines.splice(genreIndex + 1, 0, ...extra)
  } else {
    if (fields.genre !== undefined) lines.push(`genre: ${yamlScalar(fields.genre)}`)
    lines.push(...extra)
  }

  const newFm = lines.join(eol)
  return `${bom}---${eol}${newFm}${eol}---${rest.slice(match[0].length)}`
}

/** 读取 tags：支持 [a, b] 与多行数组 */
function normalizeTags(data) {
  if (Array.isArray(data.tags)) return data.tags.map(String)
  if (typeof data.tags === 'string') {
    return data.tags.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }
  return []
}

function pct(n, total) {
  if (!total) return '0%'
  return `${((n / total) * 100).toFixed(1)}%`
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const scanStep = log.step('扫描作品')
  const files = (await fg('**/*.md', { cwd: POEM_DIR, absolute: true })).sort((a, b) => a.localeCompare(b, 'zh'))
  scanStep.end('扫描到 {0} 篇作品', files.length)

  const parseStep = log.step('解析 frontmatter 与正文')
  const records = []
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = matter(raw)
    const data = parsed.data
    const form = String(data.form ?? '')
    const genre = String(data.genre ?? '').trim() || UNCLASSIFIED
    records.push({
      file,
      srcPath: path.relative(ROOT, file).split(path.sep).join('/'),
      id: String(data.id ?? ''),
      title: String(data.title ?? ''),
      author: String(data.author ?? ''),
      dynasty: String(data.dynasty ?? ''),
      form,
      genre,
      tags: normalizeTags(data),
      body: extractOriginal(parsed.content),
      raw,
      data,
    })
  }
  parseStep.end('解析完成：{0} 篇', records.length)

  const initialCounts = new Map()
  for (const r of records) initialCounts.set(r.genre, (initialCounts.get(r.genre) ?? 0) + 1)

  const classifyStep = log.step('规则标注')
  const autoResults = []
  const manualResults = []
  const unlabeled = []

  for (const rec of records) {
    const source = String(rec.data.genre_source ?? '')
    const isManual = rec.genre !== UNCLASSIFIED && rec.genre !== '' && source !== 'auto'
    const isAuto = source === 'auto'

    // 人工标注：永不覆盖，只补 genre_source: manual
    if (isManual) {
      manualResults.push(rec)
      if (String(rec.data.genre_source ?? '') !== 'manual') {
        rec.patch = { source: 'manual' }
      }
      continue
    }

    // 已自动标注：默认跳过（幂等）；--force 时重新评估
    if (isAuto && !force && rec.genre !== UNCLASSIFIED) {
      autoResults.push({
        ...rec,
        genre: String(rec.data.genre ?? ''),
        confidence: String(rec.data.genre_confidence ?? ''),
        rule: String(rec.data.genre_rule ?? ''),
        unchanged: true,
      })
      continue
    }

    // ① tags 直接采信
    const tagGenre = rec.tags.map((t) => TAG_GENRE_MAP[t]).find(Boolean)
    if (tagGenre) {
      const confidence = 'high'
      const rule = `标签「${rec.tags.find((t) => TAG_GENRE_MAP[t] === tagGenre)}」直接采信`
      rec.patch = { genre: tagGenre, source: 'auto', confidence, rule }
      autoResults.push({ ...rec, genre: tagGenre, confidence, rule, matchedTags: true })
      log.debug('{0} → {1}（{2}）：{3}', rec.title, tagGenre, confidence, rule)
      continue
    }

    // ② 标题 + ③ 正文 + ④ 体裁先验
    const { candidates, best, lowCandidates } = scorePoem(rec)

    // 作者/出处先验：作为并列时的加权来源（仅在无标题/正文命中时兜底）
    const priorGenre = AUTHOR_PRIOR[rec.author]
    if (priorGenre && (!best || best.score < MEDIUM_THRESHOLD)) {
      const prior = candidates.find((c) => c.genre === priorGenre)
      if (prior) {
        prior.score += 2
        prior.prior = true
        candidates.sort((a, b) => b.score - a.score || b.bodyHits.length - a.bodyHits.length)
      }
    }

    const top = candidates[0] ?? null
    const topTie = Boolean(top && candidates[1] && candidates[1].score === top.score)

    if (!top || top.score < MEDIUM_THRESHOLD) {
      const low = lowCandidates[0]
      const reason = low
        ? `低置信（仅命中「${low.bodyHits[0].word}」1 个特征词：${low.genre}）`
        : '无有效特征词'
      unlabeled.push({ ...rec, reason, candidates, lowCandidate: low })
      log.debug('{0} 未判定：{1}', rec.title, reason)
      if (rec.data.genre_source === 'auto' && force) {
        rec.patch = { genre: UNCLASSIFIED, source: null, confidence: null, rule: null }
      }
      continue
    }

    if (topTie) {
      const rivals = candidates
        .filter((c) => c.score === top.score)
        .map((c) => `${c.genre} ${c.score} 分 [${c.bodyHits.map((h) => h.word).join('/') || '仅标题'}]`)
      const reason = `并列第一（${rivals.join(' / ')}）`
      unlabeled.push({ ...rec, reason, candidates })
      log.debug('{0} 未判定：{1}', rec.title, reason)
      if (rec.data.genre_source === 'auto' && force) {
        rec.patch = { genre: UNCLASSIFIED, source: null, confidence: null, rule: null }
      }
      continue
    }

    const confidence = top.score >= HIGH_THRESHOLD && !top.capMedium ? 'high' : 'medium'
    const rule = buildRule({ ...top, titleMatch: rec.title })
    rec.patch = { genre: top.genre, source: 'auto', confidence, rule }
    autoResults.push({ ...rec, genre: top.genre, confidence, rule, score: top.score, bodyHits: top.bodyHits, titleHits: top.titleHits })
    log.debug('{0} → {1}（{2}，{3} 分）：{4}', rec.title, top.genre, confidence, top.score, rule)
  }
  classifyStep.end('标注完成：自动 {0} 篇 · 人工 {1} 篇 · 未定 {2} 篇', autoResults.length, manualResults.length, unlabeled.length)

  // ── 写回 md ──
  const writeStep = log.step(dryRun ? '预演写回（不落盘）' : '写回 frontmatter')
  let changed = 0
  const changes = []
  for (const rec of records) {
    if (!rec.patch) continue
    const before = rec.raw
    const after = patchFrontmatter(before, rec.patch)
    if (after !== before) {
      changed += 1
      changes.push(rec)
      if (!dryRun) fs.writeFileSync(rec.file, after, 'utf8')
    }
  }
  writeStep.end('{0}：{1} 篇', dryRun ? '预演变更' : '已更新', changed)

  // ── 统计 ──
  const finalCounts = new Map()
  for (const rec of records) {
    const g = rec.patch?.genre ?? rec.genre
    finalCounts.set(g, (finalCounts.get(g) ?? 0) + 1)
  }
  const autoByGenre = new Map()
  for (const r of autoResults) autoByGenre.set(r.genre, (autoByGenre.get(r.genre) ?? 0) + 1)
  const confidenceCounts = { high: 0, medium: 0, low: 0 }
  for (const r of autoResults) {
    if (r.confidence === 'high') confidenceCounts.high += 1
    else if (r.confidence === 'medium') confidenceCounts.medium += 1
    else if (r.confidence === 'low') confidenceCounts.low += 1
  }
  // low 不写入 md；统计仍保持「只命中 1 个特征词」的未定条目，便于报告解释
  confidenceCounts.low = unlabeled.filter((r) => r.lowCandidate).length
  const remaining = records.filter((r) => (r.patch?.genre ?? r.genre) === UNCLASSIFIED).length
  const manualLegacy = manualResults.filter((r) => !ALL_GENRES.has(r.genre))

  // ── 生成 docs/genre-review.md ──
  const docStep = log.step('生成题材校对清单')
  const doc = buildDoc({ records, autoResults, manualResults, unlabeled, finalCounts, autoByGenre, confidenceCounts, remaining, manualLegacy })
  if (!dryRun) {
    fs.mkdirSync(DOCS_DIR, { recursive: true })
    fs.writeFileSync(DOC_PATH, doc, 'utf8')
  }
  docStep.end('已生成 docs/genre-review.md（{0} 行）', doc.split('\n').length)

  // ── 中文日志汇总 ──
  log.summary('题材标注摘要', [
    ['作品总数', `${records.length} 篇`],
    ['初始待归类', `${initialCounts.get(UNCLASSIFIED) ?? 0} 篇`],
    ['本次自动标注', `${autoResults.filter((r) => !r.unchanged).length} 篇`],
    ['人工标注（保留）', `${manualResults.length} 篇`],
    ['仍未判定', `${remaining} 篇`],
    ['置信度', `high ${confidenceCounts.high} · medium ${confidenceCounts.medium} · low ${confidenceCounts.low}`],
    ['变更文件', `${changed} 篇${dryRun ? '（预演）' : ''}`],
    ['报告', 'docs/genre-review.md'],
  ])

  const genreRows = [...finalCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([genre, count]) => [genre, `${count} 篇`])
  log.summary('各题材数量（含人工）', genreRows)

  if (manualLegacy.length) {
    log.warn('以下人工题材不在固定枚举内，按「不得覆盖」保留：{0}', manualLegacy.map((r) => `${r.title}（${r.genre}）`).join('、'))
  }
  if (remaining > 40) {
    log.warn('仍未判定 {0} 篇，超过目标 40 篇；请补充规则或人工校对', remaining)
  }
  if (verbose) {
    const autoRows = autoResults
      .filter((r) => !r.unchanged)
      .map((r) => [`${r.title}（${r.author}）`, `${r.genre} · ${r.confidence}`])
    log.summary('自动标注明细（详细模式）', autoRows)
  }
}

/** 生成 Markdown 报告 */
function buildDoc({ records, autoResults, manualResults, unlabeled, finalCounts, autoByGenre, confidenceCounts, remaining, manualLegacy }) {
  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const total = records.length
  const labeledAuto = autoResults.filter((r) => !r.unchanged)
  const sortedAuto = [...autoResults].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 }
    return (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3)
      || a.genre.localeCompare(b.genre, 'zh')
      || a.title.localeCompare(b.title, 'zh')
  })

  const lines = []
  lines.push('# 题材标注校对清单')
  lines.push('')
  lines.push(`> 生成时间：${stamp}　·　工具：\`scripts/tag-genre.mjs\`　·　作品总数：${total} 篇`)
  lines.push('>')
  lines.push('> 规则：标题命中 +2 分；正文特征词命中 ≥2 个才计分（加权）；')
  lines.push('> score ≥ 4 为 high，2-3 为 medium；四时/论说无标题明示时最高 medium；low 或并列第一保持「待归类」。')
  lines.push('> 人工标注（genre_source: manual）永不覆盖。')
  lines.push('')
  lines.push('## 总览')
  lines.push('')
  lines.push('| 指标 | 数量 |')
  lines.push('| --- | ---: |')
  lines.push(`| 作品总数 | ${total} |`)
  lines.push(`| 自动标注总数 | ${autoResults.length} |`)
  lines.push(`| 本次新标注 / 重新标注 | ${labeledAuto.length} |`)
  lines.push(`| 人工标注（保留） | ${manualResults.length} |`)
  lines.push(`| 仍未判定 | ${remaining} |`)
  lines.push(`| high | ${confidenceCounts.high} |`)
  lines.push(`| medium | ${confidenceCounts.medium} |`)
  lines.push(`| low（未写入） | ${confidenceCounts.low} |`)
  lines.push('')
  lines.push('### 各题材数量（最终，含人工）')
  lines.push('')
  lines.push('| 题材 | 数量 | 其中自动 |')
  lines.push('| --- | ---: | ---: |')
  for (const [genre, count] of [...finalCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))) {
    lines.push(`| ${genre} | ${count} | ${autoByGenre.get(genre) ?? 0} |`)
  }
  lines.push('')
  lines.push('## 自动标注清单（按置信度排序）')
  lines.push('')
  lines.push('| 篇名 | 作者 | 体裁 | 判定题材 | 置信度 | 依据 | 源文件 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const r of sortedAuto) {
    lines.push(`| ${r.title} | ${r.author} | ${r.form} | ${r.genre} | ${r.confidence} | ${r.rule.replace(/\|/g, '\\|')} | \`${r.srcPath}\` |`)
  }
  lines.push('')
  if (manualResults.length) {
    lines.push('## 人工标注（保留，不参与自动判定）')
    lines.push('')
    lines.push('| 篇名 | 作者 | 体裁 | 题材 | 备注 |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const r of manualResults.sort((a, b) => a.title.localeCompare(b.title, 'zh'))) {
      const legacy = ALL_GENRES.has(r.genre) ? '' : '旧标签（不在固定枚举内）'
      lines.push(`| ${r.title} | ${r.author} | ${r.form} | ${r.genre} | ${legacy} |`)
    }
    lines.push('')
  }
  if (manualLegacy.length) {
    lines.push(`> 注意：${manualLegacy.map((r) => `「${r.title}」→ ${r.genre}`).join('、')} 使用旧标签；按“人工标注不得覆盖”的要求原样保留。`)
    lines.push('')
  }
  lines.push('## 未判定清单')
  lines.push('')
  if (!unlabeled.length) {
    lines.push('无。')
  } else {
    lines.push('| 篇名 | 作者 | 体裁 | 原因 | 候选（分数） |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const r of unlabeled.sort((a, b) => a.title.localeCompare(b.title, 'zh'))) {
      const pool = r.lowCandidate ? [r.lowCandidate, ...(r.candidates ?? [])] : (r.candidates ?? [])
      const cands = pool
        .slice(0, 3)
        .map((c) => `${c.genre} ${c.score}`)
        .join(' / ') || '—'
      lines.push(`| ${r.title} | ${r.author} | ${r.form} | ${r.reason} | ${cands} |`)
    }
  }
  lines.push('')
  lines.push('## 复跑方式')
  lines.push('')
  lines.push('```bash')
  lines.push('node scripts/tag-genre.mjs            # 只标注仍为「待归类」的作品（幂等）')
  lines.push('node scripts/tag-genre.mjs --force    # 重新评估本工具曾标注的作品（人工标注不动）')
  lines.push('node scripts/tag-genre.mjs --dry-run  # 只统计并生成报告，不写回 md')
  lines.push('```')
  lines.push('')
  lines.push('校对闭环：打开站点 `/explore/genre-review`，逐条确认/改判并导出 Markdown，再按 `srcPath` 回写 frontmatter。')
  lines.push('')
  return lines.join('\n')
}

main().catch((err) => {
  log.error('题材标注失败：{0}', err?.stack ?? err)
})
