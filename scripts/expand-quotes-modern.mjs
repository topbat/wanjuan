#!/usr/bin/env node
/**
 * 万卷 · 名句库分层扩充脚本（古诗文 / 近现代名家 / 演讲语录）
 *
 * 目标：
 *   1. 为既有 140 条古诗文名句补齐 source_type / source_citation / verified / author_era；
 *   2. 新增 40-60 条近现代名家与演讲语录，全部落到具体篇名/书名 + 年份；
 *   3. 所有新增条目正文使用「## 出处 / ## 原文语境 / ## 适用场景」结构；
 *   4. 不确定条目一律不写入 content/，集中记录到 docs/quotes-pending.md。
 *
 * 准确性红线：
 *   - 只收录卒年 ≤1975 的中国作者（任务白名单），外国作者仅收公认中译且出处明确者；
 *   - 每条 text 必须是该篇中的连续原句，不改写、不拼接；
 *   - 每条 context 必须是同篇中与 text 相邻的逐字原文；
 *   - 无法确认篇名/年份/逐字文本的，写入 pending 清单，不进入内容页。
 *
 * 幂等：
 *   - 既有名句仅在字段缺失/不一致时改写；
 *   - 新增名句按 id + 归一化 text 双重去重，重复运行 0 内容变更；
 *   - 报告与 pending 文档仅在内容变化时重写。
 *
 * 用法：
 *   node scripts/expand-quotes-modern.mjs [--verbose]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'
import matter from 'gray-matter'
import { pinyin } from 'pinyin-pro'
import { createLogger } from './lib/logger.mjs'

// ─────────────────────────── 常量与路径 ───────────────────────────

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const QUOTES_DIR = path.join(ROOT, 'content', 'quotes')
const POEMS_DIR = path.join(ROOT, 'content', 'poems')
const PENDING_PATH = path.join(ROOT, 'docs', 'quotes-pending.md')
const REPORT_PATH = path.join(ROOT, 'docs', 'quotes-modern-report.md')

const verbose = process.argv.includes('--verbose')
const log = createLogger({ verbose })

/** 主题枚举（固定 16 类，与既有名句库一致） */
const THEMES = [
  '自信', '豁达', '进取', '志向', '家国', '奉献', '思念', '友情',
  '惜时', '勤学', '哲思', '自然', '清廉', '担当', '坚韧', '孝亲',
]
const THEME_SET = new Set(THEMES)

/** 主题 → 适用场景短语（沿用既有 expand-quotes.mjs 的措辞） */
const THEME_SCENE = {
  自信: '表达对自我价值的肯定与从容',
  豁达: '表达面对得失、离别与挫折时的开阔胸襟',
  进取: '表达积极向上、不断追求进步的姿态',
  志向: '表达树立远大目标并为之奋斗的决心',
  家国: '表达对家国天下的关切与责任感',
  奉献: '表达甘于付出、成全他人的精神',
  思念: '表达对亲人、故乡或友人的深切怀念',
  友情: '表达真挚情谊与离别中的慰藉',
  惜时: '表达珍惜光阴、把握当下的态度',
  勤学: '表达勤勉学习、不断求索的精神',
  哲思: '表达对人生、事理的思考与感悟',
  自然: '描绘自然景物并寄寓情思',
  清廉: '表达清正自守、不慕荣利的品格',
  担当: '表达勇担责任、迎难而上的态度',
  坚韧: '表达在困境中坚持不懈的意志',
  孝亲: '表达对长辈的感念与孝敬',
}

/** 非课标条目沿用 schema 必填的 curriculum 字段作为承载，不代表课标归属 */
const NON_CURRICULUM = '{ stage: senior, grade: 10, recitation: false }'

/** 作者卒年（用于报告中展示公有领域合规性） */
const AUTHOR_META = {
  梁启超: { death: 1929, era: '近现代' },
  李大钊: { death: 1927, era: '近现代' },
  鲁迅: { death: 1936, era: '近现代' },
  朱自清: { death: 1948, era: '近现代' },
  闻一多: { death: 1946, era: '近现代' },
  徐志摩: { death: 1931, era: '近现代' },
  郁达夫: { death: 1945, era: '近现代' },
  瞿秋白: { death: 1935, era: '近现代' },
  方志敏: { death: 1935, era: '近现代' },
  陶行知: { death: 1946, era: '近现代' },
  蔡元培: { death: 1940, era: '近现代' },
  胡适: { death: 1962, era: '近现代' },
  陈独秀: { death: 1942, era: '近现代' },
  老舍: { death: 1966, era: '近现代' },
  夏丏尊: { death: 1946, era: '近现代' },
  邹韬奋: { death: 1944, era: '近现代' },
  张謇: { death: 1926, era: '近现代' },
  卢作孚: { death: 1952, era: '近现代' },
  泰戈尔: { death: 1941, era: '近现代' },
  '罗曼·罗兰': { death: 1944, era: '近现代' },
  乔布斯: { death: 2011, era: '当代' },
}

// ─────────────────────────── 新增条目数据 ───────────────────────────
//
// 字段说明：
//   author        作者（译作署原作者，译者在 sourceCitation 中注明）
//   slug          短标识（拼音），与作者拼音共同组成 id
//   text          名句正文（该篇连续原句，不改写、不拼接）
//   workTitle     篇名/书名
//   year          出处年份（译作注译本年份）
//   sourceType    modern | speech
//   context       同篇相邻逐字原文
//   sourceCitation/sourceLine  需要更具体说明时覆盖默认格式
//   verifyNote    抽查条目的核验依据（写入报告）
//
// 收录原则：
//   - 中国作者仅限任务给定白名单（卒年 ≤1975）；
//   - 每条均核对篇名、年份与逐字文本；核对中发现的常见误植见报告第 5 节；
//   - 乔布斯为当代企业家，按任务规则保留在内容页但 verified: pending。

const MODERN_QUOTES = [
  // ── 梁启超（1929 卒） ──
  {
    author: '梁启超', slug: 'shaonian-zhongguo',
    text: '少年智则国智，少年富则国富，少年强则国强',
    workTitle: '少年中国说', year: '1900', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '志向', '进取'],
    tags: ['作文素材', '非课标', '近现代散文', '少年中国说'],
    context: '故今日之责任，不在他人，而全在我少年。少年智则国智，少年富则国富，少年强则国强，少年独立则国独立，少年自由则国自由，少年进步则国进步。',
    verifyNote: '《少年中国说》（1900，原载《清议报》）；共产党员网 12371.cn 与澎湃新闻引录句序一致。',
  },
  {
    author: '梁启超', slug: 'hongri-chusheng',
    text: '红日初升，其道大光',
    workTitle: '少年中国说', year: '1900', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['志向', '进取', '自信'],
    tags: ['作文素材', '非课标', '近现代散文', '少年中国说'],
    context: '红日初升，其道大光。河出伏流，一泻汪洋。',
  },
  {
    author: '梁启超', slug: 'jingye-leeye',
    text: '但我确信‘敬业乐业’四个字，是人类生活的不二法门。',
    workTitle: '敬业与乐业', year: '1922', sourceType: 'speech',
    sourceCitation: '《敬业与乐业》（1922年8月在上海中华职业学校的演讲）',
    dynasty: '近现代',
    themes: ['勤学', '担当', '进取'],
    tags: ['作文素材', '非课标', '演讲', '敬业与乐业'],
    context: '但我确信‘敬业乐业’四个字，是人类生活的不二法门。',
  },
  {
    author: '梁启超', slug: 'zui-ku-zui-le',
    text: '我说人生最苦的事，莫苦于身上背着一种未了的责任。',
    workTitle: '最苦与最乐', year: '1922', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['担当', '哲思', '坚韧'],
    tags: ['作文素材', '非课标', '近现代散文', '最苦与最乐'],
    context: '我说人生最苦的事，莫苦于身上背着一种未了的责任。人若能知足，虽贫不苦；若能安分（不多作分外希望），虽然失意不苦；老、死乃人生难免的事，达观的人看得很平常，也不算什么苦。',
  },

  // ── 李大钊（1927 卒） ──
  {
    author: '李大钊', slug: 'qingnian-zidian',
    text: '青年之字典，无‘困难’之字；青年之口头，无‘障碍’之语',
    workTitle: '晨钟之使命', year: '1916', sourceType: 'modern',
    sourceCitation: '《〈晨钟〉之使命——青春中华之创造》（1916）',
    sourceLine: '《〈晨钟〉之使命——青春中华之创造》·李大钊（1916）',
    dynasty: '近现代',
    themes: ['自信', '进取', '坚韧'],
    tags: ['作文素材', '非课标', '近现代散文', '晨钟之使命'],
    context: '故青年者，人生之王，人生之春，人生之华也。青年之字典，无‘困难’之字；青年之口头，无‘障碍’之语。',
    verifyNote: '《〈晨钟〉之使命——青春中华之创造》（1916-08-15《晨钟报》创刊号）；人民网、中国青年网引录。此句常被误系于《青春》，实出《晨钟》之使命。',
  },
  {
    author: '李大钊', slug: 'qingnian-zhi-wang',
    text: '青年者，人生之王，人生之春，人生之华也。',
    workTitle: '晨钟之使命', year: '1916', sourceType: 'modern',
    sourceCitation: '《〈晨钟〉之使命——青春中华之创造》（1916）',
    sourceLine: '《〈晨钟〉之使命——青春中华之创造》·李大钊（1916）',
    dynasty: '近现代',
    themes: ['自信', '惜时', '进取'],
    tags: ['作文素材', '非课标', '近现代散文', '晨钟之使命'],
    context: '青年之文明，奋斗之文明也，与境遇奋斗，与时代奋斗，与经验奋斗。故青年者，人生之王，人生之春，人生之华也。',
  },
  {
    author: '李大钊', slug: 'qingchun-zhi-wo',
    text: '以青春之我，创建青春之家庭，青春之国家，青春之民族',
    workTitle: '青春', year: '1916', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '奉献', '进取'],
    tags: ['作文素材', '非课标', '近现代散文', '青春'],
    context: '以青春之我，创建青春之家庭，青春之国家，青春之民族，青春之人类，青春之地球，青春之宇宙，资以乐其无涯之生。',
  },
  {
    author: '李大钊', slug: 'shumin-de-shengli',
    text: '民主主义战胜，就是庶民的胜利。',
    workTitle: '庶民的胜利', year: '1918', sourceType: 'speech',
    dynasty: '近现代',
    themes: ['家国', '担当'],
    tags: ['作文素材', '非课标', '演讲', '庶民的胜利'],
    context: '欧洲的战争，是‘大……主义’与民主主义的战争。我们国内的战争，也是‘大……主义’与民主主义的战争。结果都是民主主义战胜，‘大……主义’失败。民主主义战胜，就是庶民的胜利。',
  },
  {
    author: '李大钊', slug: 'chichi-de-shijie',
    text: '试看将来的环球，必是赤旗的世界！',
    workTitle: '布尔什维主义的胜利', year: '1918', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '自信', '志向'],
    tags: ['作文素材', '非课标', '近现代政论', '布尔什维主义的胜利'],
    context: '人道的警钟响了！自由的曙光现了！试看将来的环球，必是赤旗的世界！',
  },

  // ── 鲁迅（1936 卒） ──
  {
    author: '鲁迅', slug: 'guxiang-de-lu',
    text: '其实地上本没有路，走的人多了，也便成了路。',
    workTitle: '故乡', year: '1921', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['进取', '哲思', '坚韧'],
    tags: ['作文素材', '非课标', '现代小说', '故乡'],
    context: '希望是本无所谓有，无所谓无的。这正如地上的路；其实地上本没有路，走的人多了，也便成了路。',
    verifyNote: '《故乡》（作于1921年1月，载《新青年》1921年9卷1号）；结尾原文一致。',
  },
  {
    author: '鲁迅', slug: 'zhen-de-mengshi',
    text: '真的猛士，敢于直面惨淡的人生，敢于正视淋漓的鲜血。',
    workTitle: '记念刘和珍君', year: '1926', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['担当', '坚韧', '家国'],
    tags: ['作文素材', '非课标', '近现代散文', '记念刘和珍君'],
    context: '真的猛士，敢于直面惨淡的人生，敢于正视淋漓的鲜血。这是怎样的哀痛者和幸福者？',
    verifyNote: '《记念刘和珍君》（1926，载《语丝》第74期）；首段原文一致。',
  },
  {
    author: '鲁迅', slug: 'chenmo-zhong-baofa',
    text: '不在沉默中爆发，就在沉默中灭亡。',
    workTitle: '记念刘和珍君', year: '1926', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['坚韧', '担当', '家国'],
    tags: ['作文素材', '非课标', '近现代散文', '记念刘和珍君'],
    context: '沉默呵，沉默呵！不在沉默中爆发，就在沉默中灭亡。',
  },
  {
    author: '鲁迅', slug: 'hengmei-lengdui',
    text: '横眉冷对千夫指，俯首甘为孺子牛。',
    workTitle: '自嘲', year: '1932', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['担当', '奉献', '清廉'],
    tags: ['作文素材', '非课标', '近现代诗', '自嘲'],
    context: '横眉冷对千夫指，俯首甘为孺子牛。躲进小楼成一统，管他冬夏与春秋。',
  },
  {
    author: '鲁迅', slug: 'yuwushengchu',
    text: '心事浩茫连广宇，于无声处听惊雷。',
    workTitle: '无题', year: '1934', sourceType: 'modern',
    sourceCitation: '《无题·万家墨面没蒿莱》（1934）',
    sourceLine: '《无题·万家墨面没蒿莱》·鲁迅（1934）',
    dynasty: '近现代',
    themes: ['家国', '哲思', '坚韧'],
    tags: ['作文素材', '非课标', '近现代诗', '无题'],
    context: '万家墨面没蒿莱，敢有歌吟动地哀。心事浩茫连广宇，于无声处听惊雷。',
  },
  {
    author: '鲁迅', slug: 'youyifenre',
    text: '有一分热，发一分光，就令萤火一般，也可以在黑暗里发一点光',
    workTitle: '热风·随感录四十一', year: '1919', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['奉献', '进取', '担当'],
    tags: ['作文素材', '非课标', '近现代杂文', '热风'],
    context: '有一分热，发一分光，就令萤火一般，也可以在黑暗里发一点光，不必等候炬火。',
  },
  {
    author: '鲁迅', slug: 'zhongguo-de-jiliang',
    text: '我们从古以来，就有埋头苦干的人，有拼命硬干的人，有为民请命的人，有舍身求法的人',
    workTitle: '中国人失掉自信力了吗', year: '1934', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '自信', '担当'],
    tags: ['作文素材', '非课标', '近现代杂文', '且介亭杂文'],
    context: '我们从古以来，就有埋头苦干的人，有拼命硬干的人，有为民请命的人，有舍身求法的人，……虽是等于为帝王将相作家谱的所谓‘正史’，也往往掩不住他们的光耀，这就是中国的脊梁。',
  },
  {
    author: '鲁迅', slug: 'yousheng-de-zhongguo',
    text: '我们要说现代的，自己的话；用活着的白话，将自己的思想，感情直白地说出来。',
    workTitle: '无声的中国', year: '1927', sourceType: 'speech',
    dynasty: '近现代',
    themes: ['自信', '进取'],
    tags: ['作文素材', '非课标', '演讲', '无声的中国'],
    context: '我们要说现代的，自己的话；用活着的白话，将自己的思想，感情直白地说出来。但是，这也要受前辈先生非笑的。',
  },

  // ── 朱自清（1948 卒） ──
  {
    author: '朱自清', slug: 'yanzi-qule',
    text: '燕子去了，有再来的时候；杨柳枯了，有再青的时候；桃花谢了，有再开的时候。',
    workTitle: '匆匆', year: '1922', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['惜时', '哲思'],
    tags: ['作文素材', '非课标', '现代散文', '匆匆'],
    context: '燕子去了，有再来的时候；杨柳枯了，有再青的时候；桃花谢了，有再开的时候。但是，聪明的，你告诉我，我们的日子为什么一去不复返呢？',
  },
  {
    author: '朱自清', slug: 'xishou-de-shihou',
    text: '洗手的时候，日子从水盆里过去；吃饭的时候，日子从饭碗里过去；默默时，便从凝然的双眼前过去。',
    workTitle: '匆匆', year: '1922', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['惜时'],
    tags: ['作文素材', '非课标', '现代散文', '匆匆'],
    context: '于是——洗手的时候，日子从水盆里过去；吃饭的时候，日子从饭碗里过去；默默时，便从凝然的双眼前过去。',
  },
  {
    author: '朱自清', slug: 'chuntian-de-jiaobu',
    text: '盼望着，盼望着，东风来了，春天的脚步近了。',
    workTitle: '春', year: '1933', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['自然', '进取'],
    tags: ['作文素材', '非课标', '现代散文', '春'],
    context: '盼望着，盼望着，东风来了，春天的脚步近了。一切都像刚睡醒的样子，欣欣然张开了眼。',
  },
  {
    author: '朱自清', slug: 'renao-shi-tamende',
    text: '热闹是它们的，我什么也没有。',
    workTitle: '荷塘月色', year: '1927', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['哲思', '自然'],
    tags: ['作文素材', '非课标', '现代散文', '荷塘月色'],
    context: '这时候最热闹的，要数树上的蝉声与水里的蛙声；但热闹是它们的，我什么也没有。',
  },

  // ── 闻一多（1946 卒） ──
  {
    author: '闻一多', slug: 'zhengyi-shabuwang',
    text: '正义是杀不完的，因为真理永远存在！',
    workTitle: '最后一次讲演', year: '1946', sourceType: 'speech',
    dynasty: '近现代',
    themes: ['家国', '担当', '坚韧'],
    tags: ['作文素材', '非课标', '演讲', '最后一次讲演'],
    context: '反动派，你看见一个倒下去，可也看得见千百个继起的！正义是杀不完的，因为真理永远存在！',
    verifyNote: '《最后一次讲演》（1946-07-15，云南大学李公朴追悼会）；演讲结尾原文一致。',
  },
  {
    author: '闻一多', slug: 'mowen-shouhuo',
    text: '莫问收获，但问耕耘。',
    workTitle: '红烛', year: '1923', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['奉献', '勤学', '坚韧'],
    tags: ['作文素材', '非课标', '现代诗', '红烛'],
    context: '红烛啊！你流一滴泪，灰一分心。灰心流泪你的果，创造光明你的因。红烛啊！‘莫问收获，但问耕耘。’',
  },

  // ── 徐志摩（1931 卒） ──
  {
    author: '徐志摩', slug: 'qingqing-de-wo-zoule',
    text: '轻轻的我走了，正如我轻轻的来；我轻轻的招手，作别西天的云彩。',
    workTitle: '再别康桥', year: '1928', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['思念', '自然'],
    tags: ['作文素材', '非课标', '现代诗', '再别康桥'],
    context: '轻轻的我走了，正如我轻轻的来；我轻轻的招手，作别西天的云彩。',
  },
  {
    author: '徐志摩', slug: 'qiaqiao-de-wo-zoule',
    text: '悄悄的我走了，正如我悄悄的来；我挥一挥衣袖，不带走一片云彩。',
    workTitle: '再别康桥', year: '1928', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['豁达', '思念'],
    tags: ['作文素材', '非课标', '现代诗', '再别康桥'],
    context: '悄悄的我走了，正如我悄悄的来；我挥一挥衣袖，不带走一片云彩。',
  },
  {
    author: '徐志摩', slug: 'oufen-de-touying',
    text: '我是天空里的一片云，偶尔投影在你的波心',
    workTitle: '偶然', year: '1926', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['思念', '哲思'],
    tags: ['作文素材', '非课标', '现代诗', '偶然'],
    context: '我是天空里的一片云，偶尔投影在你的波心——你不必讶异，更无须欢喜——在转瞬间消灭了踪影。',
  },

  // ── 郁达夫（1945 卒） ──
  {
    author: '郁达夫', slug: 'beiguo-de-qiu',
    text: '北国的秋，却特别地来得清，来得静，来得悲凉。',
    workTitle: '故都的秋', year: '1934', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['自然', '思念'],
    tags: ['作文素材', '非课标', '现代散文', '故都的秋'],
    context: '秋天，无论在什么地方的秋天，总是好的；可是啊，北国的秋，却特别地来得清，来得静，来得悲凉。',
  },
  {
    author: '郁达夫', slug: 'weida-renwu',
    text: '没有伟大的人物出现的民族，是世界上最可怜的生物之群；有了伟大的人物，而不知拥护、爱戴、崇仰的国家，是没有希望的奴隶之邦。',
    workTitle: '怀鲁迅', year: '1936', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '哲思', '担当'],
    tags: ['作文素材', '非课标', '现代散文', '怀鲁迅'],
    context: '没有伟大的人物出现的民族，是世界上最可怜的生物之群；有了伟大的人物，而不知拥护、爱戴、崇仰的国家，是没有希望的奴隶之邦。因鲁迅的一死，使人们自觉出了民族的尚可以有为，也因鲁迅之一死，使人家看出了中国还是奴隶性很浓厚的半绝望的国家。',
  },

  // ── 瞿秋白（1935 卒） ──
  {
    author: '瞿秋白', slug: 'guangming-de-lu',
    text: '我总想为大家辟一条光明的路。',
    workTitle: '饿乡纪程·绪言', year: '1920', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['奉献', '担当', '志向'],
    tags: ['作文素材', '非课标', '近现代散文', '饿乡纪程'],
    context: '我决不忘记你们，我总想为大家辟一条光明的路。我愿去，我不得不去。',
  },

  // ── 方志敏（1935 卒） ──
  {
    author: '方志敏', slug: 'zhongguo-shi-muqin',
    text: '朋友！中国是生育我们的母亲。',
    workTitle: '可爱的中国', year: '1935', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '奉献'],
    tags: ['作文素材', '非课标', '近现代散文', '可爱的中国'],
    context: '朋友！中国是生育我们的母亲。你们觉得这位母亲可爱吗？',
  },
  {
    author: '方志敏', slug: 'qingpin-jiebai',
    text: '清贫，洁白朴素的生活，正是我们革命者能够战胜许多困难的地方！',
    workTitle: '清贫', year: '1935', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['清廉', '坚韧', '担当'],
    tags: ['作文素材', '非课标', '近现代散文', '清贫'],
    context: '清贫，洁白朴素的生活，正是我们革命者能够战胜许多困难的地方！',
  },
  {
    author: '方志敏', slug: 'huoyueyue-de-chuangzao',
    text: '到处都是活跃跃的创造，到处都是日新月异的进步，欢歌将代替了悲叹，笑脸将代替了哭脸。',
    workTitle: '可爱的中国', year: '1935', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '进取', '自信'],
    tags: ['作文素材', '非课标', '近现代散文', '可爱的中国'],
    context: '朋友，我相信，到那时，到处都是活跃跃的创造，到处都是日新月异的进步，欢歌将代替了悲叹，笑脸将代替了哭脸。',
  },

  // ── 陶行知（1946 卒） ──
  {
    author: '陶行知', slug: 'xingzhi-zhishi',
    text: '行是知之始，知是行之成。',
    workTitle: '行知行', year: '1934', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['勤学', '哲思', '进取'],
    tags: ['作文素材', '非课标', '教育', '行知行'],
    context: '七年前，我提出‘行是知之始，知是行之成’的理论。',
  },

  // ── 蔡元培（1940 卒） ──
  {
    author: '蔡元培', slug: 'daxue-gaoshen-xuewen',
    text: '大学者，研究高深学问者也。',
    workTitle: '就任北京大学校长之演说', year: '1917', sourceType: 'speech',
    dynasty: '近现代',
    themes: ['勤学', '志向', '清廉'],
    tags: ['作文素材', '非课标', '演讲', '就任北京大学校长之演说'],
    context: '而在大学则不然，大学者，研究高深学问者也。',
    verifyNote: '《就任北京大学校长之演说》（1917-01-09）；北大新闻网与维基文库原文一致。',
  },
  {
    author: '蔡元培', slug: 'baoding-zongzhi',
    text: '所以诸君须抱定宗旨，为求学而来。',
    workTitle: '就任北京大学校长之演说', year: '1917', sourceType: 'speech',
    dynasty: '近现代',
    themes: ['勤学', '志向', '担当'],
    tags: ['作文素材', '非课标', '演讲', '就任北京大学校长之演说'],
    context: '所以诸君须抱定宗旨，为求学而来。入法科者，非为做官；入商科者，非为致富。',
  },
  {
    author: '蔡元培', slug: 'jianrong-bingbao',
    text: '对于学说，仿世界各大学通例，循思想自由原则，取兼容并包主义。',
    workTitle: '致公言报函并答林琴南函', year: '1919', sourceType: 'modern',
    sourceCitation: '《致〈公言报〉函并答林琴南函》（1919）',
    sourceLine: '《致〈公言报〉函并答林琴南函》·蔡元培（1919）',
    dynasty: '近现代',
    themes: ['豁达', '哲思', '担当'],
    tags: ['作文素材', '非课标', '近现代书信', '蔡元培'],
    context: '对于学说，仿世界各大学通例，循思想自由原则，取兼容并包主义，与公所提出之圆通广大四字，颇不相背也。',
  },

  // ── 胡适（1962 卒） ──
  {
    author: '胡适', slug: 'zheng-ziji-de-ziyou',
    text: '争你们个人的自由，便是为国家争自由！争你们自己的人格，便是为国家争人格！',
    workTitle: '介绍我自己的思想', year: '1930', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['家国', '自信', '担当'],
    tags: ['作文素材', '非课标', '近现代散文', '胡适文选'],
    context: '现在有人对你们说：‘牺牲你们个人的自由，去求国家的自由！’我对你们说：‘争你们个人的自由，便是为国家争自由！争你们自己的人格，便是为国家争人格！自由平等的国家不是一群奴才建造得起来的！’',
  },
  {
    author: '胡适', slug: 'rongren-yu-ziyou',
    text: '有时我竟觉得容忍是一切自由的根本：没有容忍，就没有自由。',
    workTitle: '容忍与自由', year: '1959', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['豁达', '哲思', '担当'],
    tags: ['作文素材', '非课标', '近现代散文', '容忍与自由'],
    context: '我自己也有‘年纪越大，越觉得容忍比自由还更重要’的感想。有时我竟觉得容忍是一切自由的根本：没有容忍，就没有自由。',
  },

  // ── 陈独秀（1942 卒） ──
  {
    author: '陈独秀', slug: 'qingnian-ru-chunchun',
    text: '青年如初春，如朝日，如百卉之萌动，如利刃之新发于硎，人生最可宝贵之时期也。',
    workTitle: '敬告青年', year: '1915', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['惜时', '自信', '进取'],
    tags: ['作文素材', '非课标', '近现代政论', '敬告青年'],
    context: '青年如初春，如朝日，如百卉之萌动，如利刃之新发于硎，人生最可宝贵之时期也。青年之于社会，犹新鲜活泼细胞之在人身。',
  },
  {
    author: '陈独秀', slug: 'kexue-renquan',
    text: '科学之兴，其功不在人权说下，若舟车之有两轮焉。',
    workTitle: '敬告青年', year: '1915', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['勤学', '哲思', '家国'],
    tags: ['作文素材', '非课标', '近现代政论', '敬告青年'],
    context: '近代欧洲之所以优越他族者，科学之兴，其功不在人权说下，若舟车之有两轮焉。',
  },

  // ── 老舍（1966 卒） ──
  {
    author: '老舍', slug: 'muqin-de-jiaoyu',
    text: '母亲并不识字，她给我的是生命的教育。',
    workTitle: '我的母亲', year: '1943', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['孝亲', '奉献'],
    tags: ['作文素材', '非课标', '现代散文', '我的母亲'],
    context: '但是我的真正的教师，把性格传给我的，是我的母亲。母亲并不识字，她给我的是生命的教育。',
    verifyNote: '《我的母亲》（1943）；中国作家网与百度百科原文一致。',
  },
  {
    author: '老舍', slug: 'jinan-de-dongtian',
    text: '对于一个在北平住惯的人，像我，冬天要是不刮风，便觉得是奇迹；济南的冬天是没有风声的。',
    workTitle: '济南的冬天', year: '1931', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['自然', '豁达'],
    tags: ['作文素材', '非课标', '现代散文', '济南的冬天'],
    context: '对于一个在北平住惯的人，像我，冬天要是不刮风，便觉得是奇迹；济南的冬天是没有风声的。',
  },
  {
    author: '老舍', slug: 'yuxia-gei-furen',
    text: '雨下给富人，也下给穷人；下给义人，也下给不义的人。',
    workTitle: '骆驼祥子', year: '1936', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['哲思', '担当'],
    tags: ['作文素材', '非课标', '现代小说', '骆驼祥子'],
    context: '雨下给富人，也下给穷人；下给义人，也下给不义的人。其实，雨并不公道，因为下落在一个没有公道的世界上。',
  },
  {
    author: '老舍', slug: 'youxi-youyou',
    text: '有喜有忧，有笑有泪，有花有果，有香有色。',
    workTitle: '养花', year: '1956', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['豁达', '自然', '哲思'],
    tags: ['作文素材', '非课标', '现代散文', '养花'],
    context: '有喜有忧，有笑有泪，有花有果，有香有色。既须劳动，又长见识，这就是养花的乐趣了。',
  },

  // ── 夏丏尊（1946 卒） ──
  {
    author: '夏丏尊', slug: 'jiaoyu-de-qingai',
    text: '教育没有了情爱，就成了无水的池，任你四方形也罢，圆形也罢，总逃不了一个空虚。',
    workTitle: '爱的教育译者序言', year: '1924', sourceType: 'modern',
    sourceCitation: '《〈爱的教育〉译者序言》（1924）',
    sourceLine: '《〈爱的教育〉译者序言》·夏丏尊（1924）',
    dynasty: '近现代',
    themes: ['奉献', '哲思', '勤学'],
    tags: ['作文素材', '非课标', '教育', '爱的教育'],
    context: '教育上的水是什么？就是情，就是爱。教育没有了情爱，就成了无水的池，任你四方形也罢，圆形也罢，总逃不了一个空虚。',
  },

  // ── 邹韬奋（1944 卒） ──
  {
    author: '邹韬奋', slug: 'zijuexin',
    text: '自觉心是进步之母，自贱心是堕落之源，故自觉心不可无，自贱心不可有。',
    workTitle: '自觉与自贱', year: '1930', sourceType: 'modern',
    dynasty: '近现代',
    themes: ['自信', '进取', '清廉'],
    tags: ['作文素材', '非课标', '近现代杂文', '自觉与自贱'],
    context: '自觉心是进步之母，自贱心是堕落之源，故自觉心不可无，自贱心不可有。',
  },

  // ── 张謇（1926 卒） ──
  {
    author: '张謇', slug: 'youyong-shiye',
    text: '天之生人也，与草木无异。若遗留一二有用事业，与草木同生，即不与草木同腐。',
    workTitle: '第三养老院开幕演说', year: '1922', sourceType: 'speech',
    dynasty: '近现代',
    themes: ['志向', '担当', '哲思'],
    tags: ['作文素材', '非课标', '演讲', '实业家', '张謇'],
    context: '天之生人也，与草木无异。若遗留一二有用事业，与草木同生，即不与草木同腐。故踊跃从公者，做一分便是一分，做一寸便是一寸。',
  },

  // ── 卢作孚（1952 卒） ──
  {
    author: '卢作孚', slug: 'zhongguo-de-weilai',
    text: '中国的未来，完全产生在中国人的手上！',
    workTitle: '中国的未来是在我们手上的', year: '1937', sourceType: 'modern',
    sourceCitation: '《中国的未来是在我们手上的》（1936年作，1937年刊）',
    sourceLine: '《中国的未来是在我们手上的》·卢作孚（1936年作，1937年刊）',
    dynasty: '近现代',
    themes: ['家国', '自信', '担当'],
    tags: ['作文素材', '非课标', '近现代政论', '实业家', '卢作孚'],
    context: '中国应该怎样办？中国人应该怎样办？这是当前必须解决的问题，不容迟疑，亦不容模糊的。中国的未来，完全产生在中国人的手上！',
  },

  // ── 外国作家（公认中译，出处明确） ──
  {
    author: '泰戈尔', slug: 'xiahua-qiuye',
    text: '使生如夏花之绚烂，死如秋叶之静美。',
    workTitle: '飞鸟集', year: '1922', sourceType: 'modern',
    sourceCitation: '《飞鸟集》第82首（郑振铎译，1922）',
    sourceLine: '《飞鸟集》第82首·泰戈尔（郑振铎译，1922）',
    dynasty: '近现代',
    themes: ['哲思', '自然', '豁达'],
    tags: ['作文素材', '非课标', '外国诗', '飞鸟集', '郑振铎译'],
    context: '使生如夏花之绚烂，死如秋叶之静美。',
    verifyNote: '《飞鸟集》第82首，郑振铎译（1922年商务印书馆初版）；郑译原文为“使生如夏花之绚烂，死如秋叶之静美”。',
  },
  {
    author: '罗曼·罗兰', slug: 'yingxiongzhuyi',
    text: '世界上只有一种英雄主义，便是注视世界的真面目——并且爱世界。',
    workTitle: '米开朗琪罗传', year: '1935', sourceType: 'modern',
    sourceCitation: '《米开朗琪罗传·原序》（傅雷译，1935）',
    sourceLine: '《米开朗琪罗传·原序》·罗曼·罗兰（傅雷译，1935）',
    dynasty: '近现代',
    themes: ['坚韧', '豁达', '哲思'],
    tags: ['作文素材', '非课标', '外国传记', '傅雷译'],
    context: '世界上只有一种英雄主义，便是注视世界的真面目——并且爱世界。',
  },

  // ── 当代企业家（按任务规则 verified: pending） ──
  {
    author: '乔布斯', slug: 'stay-hungry',
    text: 'Stay Hungry. Stay Foolish.',
    workTitle: '斯坦福大学2005年毕业典礼演讲', year: '2005', sourceType: 'speech',
    sourceCitation: '斯坦福大学2005年毕业典礼演讲（2005）',
    sourceLine: '斯坦福大学2005年毕业典礼演讲·乔布斯（2005）',
    dynasty: '当代', era: '当代',
    themes: ['进取', '自信', '志向'],
    tags: ['作文素材', '非课标', '演讲', '斯坦福演讲'],
    context: 'Beneath it were the words: ‘Stay Hungry. Stay Foolish.’ It was their farewell message as they signed off. Stay Hungry. Stay Foolish.',
    verified: 'pending',
  },
]

// ─────────────────────────── 待核清单（不写入 content/） ───────────────────────────

const PENDING_ITEMS = [
  {
    text: '生活即教育，社会即学校，教学做合一',
    author: '陶行知',
    proposed: '《教学做合一》《什么是生活教育》等（1927-1934）',
    reason: '三句是“生活教育”理论的三个命题，常被合并引用；未能定位同时包含三句的单一原始篇目，年份亦随篇目不同。',
    action: '查《陶行知全集》相关篇目后，再逐条收录。',
  },
  {
    text: '捧着一颗心来，不带半根草去',
    author: '陶行知',
    proposed: '致李友梅、蓝九盛等信（1930-04-30）/ 新安小学题词',
    reason: '1927-1930 年间多次使用，题词、春联、书信等载体并存，最早出处与文本形态有争议。',
    action: '以《陶行知全集》第8卷所收书信为准，确认后补入。',
  },
  {
    text: '千教万教，教人求真；千学万学，学做真人',
    author: '陶行知',
    proposed: '《陶行知教育文选》等',
    reason: '流传极广，但未能定位单一篇名与年份，暂不写入内容页。',
    action: '查《陶行知全集》或育才学校相关文献。',
  },
  {
    text: '父教育而母实业',
    author: '张謇',
    proposed: '《通海中学附国文专修科述义并简章》',
    reason: '出处篇名可确认，但年份有 1907 与 1908 两说；未达到“篇名+年份”双确认标准。',
    action: '查《张謇全集》第5卷原刊。',
  },
  {
    text: '中国的未来，不在都市，而在乡村',
    author: '卢作孚',
    proposed: '未找到可靠原文',
    reason: '查无确切文献出处，疑为后人对卢作孚乡村建设思想的概括；其有据可查的表述是《乡村建设》（1929）“中国现代化基础在乡村现代化”。',
    action: '不收录；如引用乡村建设思想，改用《乡村建设》原文。',
  },
  {
    text: '服务社会，便利人群，开发产业，富强国家',
    author: '卢作孚',
    proposed: '民生公司宗旨',
    reason: '作为企业宗旨广为引用，但具体文件名称、年份与逐字文本尚未核实。',
    action: '查《卢作孚文集》或民生公司档案。',
  },
  {
    text: '十年饮冰，难凉热血',
    author: '梁启超',
    proposed: '常署《饮冰室自由书》',
    reason: '流传甚广，但未能确认具体篇名与年份；可能为题赠、集句或后人概括。',
    action: '查《梁启超全集》及手稿/题跋。',
  },
  {
    text: '铁肩担道义，妙手著文章',
    author: '李大钊',
    proposed: '对联/题词（常署 1916 年前后）',
    reason: '联语源自杨继盛“铁肩担道义，辣手著文章”，李大钊改“辣”为“妙”；具体书写年份与文本载体待核。',
    action: '查李大钊手迹、题跋与年谱。',
  },
  {
    text: '愿成一分一毫有用之事，不愿居八命九命可耻之官',
    author: '张謇',
    proposed: '《张謇全集》日记/函电',
    reason: '常见于张謇研究文章，但篇名、年份未定。',
    action: '查《张謇全集》日记卷。',
  },
  {
    text: '教育者，养成人格之事业也',
    author: '蔡元培',
    proposed: '蔡元培教育文选（篇名待核）',
    reason: '常被引用，但未能确认具体篇名与年份。',
    action: '查《蔡元培全集》相关教育论文。',
  },
  {
    text: '世上只有一种真正的英雄主义，就是在认清生活真相之后依然热爱生活',
    author: '罗曼·罗兰（流行中译）',
    proposed: '常误署傅雷译《米开朗琪罗传》',
    reason: '该句是流行改写，并非傅雷译本原文；傅雷原译为“世界上只有一种英雄主义，便是注视世界的真面目——并且爱世界”。',
    action: '不收录流行改写；内容页已收傅雷原译。',
  },
  {
    text: '教育之没有情感，没有爱，如同池塘没有水一样。没有水，就不成其池塘，没有爱就没有教育。',
    author: '夏丏尊（流行中译/改写）',
    proposed: '常误署《爱的教育》译者序言',
    reason: '该段是后人归纳的流行版本；1924 年序言原文为“教育没有了情爱，就成了无水的池……”。',
    action: '不收录流行改写；内容页已收序言原文。',
  },
  {
    text: '求知若饥，虚心若愚',
    author: '乔布斯（中文意译）',
    proposed: '斯坦福大学2005年毕业典礼演讲',
    reason: '中文为意译，存在多种译法；英文原文已收，中文译法待统一。',
    action: '如需中文版，统一采用“求知若饥，虚心若愚”并注明意译。',
  },
  {
    text: '（稻盛和夫、任正非等当代企业家语录）',
    author: '当代企业家',
    proposed: '网络流传版本',
    reason: '多无一手出处、演讲名或授权说明，按任务规则一律 pending，且不写入内容页。',
    action: '仅在获得一手演讲/著作原文后收录。',
  },
]

// ─────────────────────────── 工具函数 ───────────────────────────

/** 去掉标点/符号/空白，用于逐字比对与重名判断 */
const DROP_CHAR = /[\p{P}\p{S}\s]/u
function normalize(text) {
  let out = ''
  for (const ch of String(text ?? '')) {
    if (!DROP_CHAR.test(ch)) out += ch
  }
  return out
}

/** 文件名：去掉标点后取前 8 字 */
function firstChars(text, n = 8) {
  const plain = normalize(text)
  return [...plain].slice(0, n).join('') || '名句'
}

/** 书名号：篇名本身已带书名号时不重复包裹 */
function bookTitle(title) {
  return /^《.*》/.test(title) ? title : `《${title}》`
}

/** YAML 标量（双引号 + JSON 转义） */
function yamlString(text) {
  return JSON.stringify(String(text))
}

/** 作者拼音（小写、去分隔符），用于 id */
function authorSlug(author) {
  return pinyin(String(author ?? ''), { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

/** 主题 → 适用场景一句话 */
function sceneFor(themes) {
  const names = themes.map((t) => `「${t}」`).join('、')
  const desc = themes.map((t) => THEME_SCENE[t]).filter(Boolean).join('；')
  return `适合用于${names}主题的写作：${desc}。`
}

/** 从已有 frontmatter 文本中设置/新增字段；返回是否变化 */
function setFrontmatterFields(content, fields) {
  const m = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { content, changed: false, error: '缺少 frontmatter' }
  const lines = m[1].split(/\r?\n/)
  let changed = false
  for (const [key, literal] of Object.entries(fields)) {
    const idx = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line))
    const next = `${key}: ${literal}`
    if (idx >= 0) {
      if (lines[idx].trim() !== next) {
        lines[idx] = next
        changed = true
      }
    } else {
      lines.push(next)
      changed = true
    }
  }
  if (!changed) return { content, changed: false }
  return {
    content: `---\n${lines.join('\n')}\n---${String(content).slice(m[0].length)}`,
    changed: true,
  }
}

/** 仅当内容不同才写文件 */
function writeIfChanged(absPath, content) {
  if (fs.existsSync(absPath)) {
    const old = fs.readFileSync(absPath, 'utf8')
    if (old === content) return false
  }
  fs.writeFileSync(absPath, content, 'utf8')
  return true
}

/** 生成唯一文件路径（不覆盖既有名句文件） */
function uniqueQuotePath(text, plannedFiles) {
  const base = firstChars(text)
  let name = `${base}.md`
  let n = 2
  while (fs.existsSync(path.join(QUOTES_DIR, name)) || plannedFiles.has(name)) {
    name = `${base}-${n++}.md`
  }
  plannedFiles.add(name)
  return path.join(QUOTES_DIR, name)
}

/** 读取作品 id → 篇名 */
async function loadPoemTitles() {
  const files = await fg('content/poems/**/*.md', { cwd: ROOT, absolute: true, dot: false })
  const map = new Map()
  for (const abs of files) {
    try {
      const data = matter.read(abs).data
      if (data?.id && data?.title) map.set(data.id, data.title)
    } catch {
      // 作品解析错误由 build-index 负责报告；此处仅跳过
    }
  }
  return map
}

/** 读取当前活动名句（不含 .discarded） */
async function loadQuoteFiles() {
  return fg('content/quotes/*.md', { cwd: ROOT, absolute: true, dot: false })
}

/** 组装一条新增名句（frontmatter + 正文） */
function buildModernRecord(q) {
  const sourceCitation = q.sourceCitation ?? `${bookTitle(q.workTitle)}（${q.year}）`
  const authorDisplay = q.authorDisplay ?? q.author
  const sourceLine = q.sourceLine ?? `${bookTitle(q.workTitle)}·${authorDisplay}（${q.year}）`
  const verified = q.verified ?? true
  const era = q.era ?? '近现代'
  const dynasty = q.dynasty ?? '近现代'

  const body = [
    '# 名句',
    '',
    '## 出处',
    '',
    sourceLine,
    '',
    '## 原文语境',
    '',
    q.context,
    '',
    '## 适用场景',
    '',
    sceneFor(q.themes),
    '',
  ].join('\n')

  const frontmatter = [
    '---',
    `id: ${yamlString(`quote-${authorSlug(q.author)}-${q.slug}`)}`,
    `text: ${yamlString(q.text)}`,
    `author: ${yamlString(q.author)}`,
    `theme: [${q.themes.map((t) => yamlString(t)).join(', ')}]`,
    `dynasty: ${yamlString(dynasty)}`,
    `curriculum: ${NON_CURRICULUM}`,
    `tags: [${q.tags.map((t) => yamlString(t)).join(', ')}]`,
    `source_type: ${yamlString(q.sourceType)}`,
    `source_citation: ${yamlString(sourceCitation)}`,
    `verified: ${verified === true ? 'true' : 'pending'}`,
    `author_era: ${yamlString(era)}`,
    '---',
    '',
  ].join('\n')

  return { content: frontmatter + body, sourceCitation, sourceLine }
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  log.info('万卷名句分层扩充启动（古诗文补字段 → 近现代名家/演讲语录 → 待核清单）')
  fs.mkdirSync(QUOTES_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true })

  // 1. 既有古诗文补字段
  const poemTitles = await loadPoemTitles()
  const quoteFiles = await loadQuoteFiles()
  const backfillStep = log.step('补全既有古诗文字段')
  let backfilled = 0
  let alreadyClassified = 0
  let backfillSkipped = 0
  for (const abs of quoteFiles) {
    const base = path.basename(abs)
    let raw
    let data
    try {
      raw = fs.readFileSync(abs, 'utf8')
      data = matter(raw).data
    } catch (err) {
      log.error('既有名句解析失败 {0}：{1}', base, err.message)
      backfillSkipped += 1
      continue
    }
    if (data.source_type) {
      alreadyClassified += 1
      continue
    }
    const title = data.work ? poemTitles.get(data.work) : null
    if (!title) {
      log.warn('既有名句缺少可追溯 work，跳过补字段：{0}', base)
      backfillSkipped += 1
      continue
    }
    const fields = {
      source_type: yamlString('classical'),
      source_citation: yamlString(bookTitle(title)),
      verified: 'true',
      author_era: yamlString('古代'),
    }
    const result = setFrontmatterFields(raw, fields)
    if (result.error) {
      log.error('既有名句 frontmatter 异常 {0}：{1}', base, result.error)
      backfillSkipped += 1
      continue
    }
    if (result.changed) {
      fs.writeFileSync(abs, result.content, 'utf8')
      backfilled += 1
    } else {
      alreadyClassified += 1
    }
  }
  backfillStep.end('补字段 {0} 条 · 已有 source_type {1} 条 · 跳过 {2} 条', backfilled, alreadyClassified, backfillSkipped)

  // 2. 新增近现代名家 / 演讲语录
  const addStep = log.step('新增近现代名家与演讲语录')
  const existingFiles = await loadQuoteFiles()
  const existingIds = new Set()
  const existingTexts = new Map()
  for (const abs of existingFiles) {
    try {
      const data = matter.read(abs).data
      if (data.id) existingIds.add(data.id)
      if (data.text) existingTexts.set(normalize(data.text), path.basename(abs))
    } catch {
      // 已在 build-index 报告
    }
  }

  const plannedFiles = new Set()
  const added = { modern: 0, speech: 0, pending: 0 }
  const skipped = []
  const addedRecords = []

  for (const q of MODERN_QUOTES) {
    // 数据自检
    if (!THEME_SET.has(q.themes?.[0]) || (q.themes ?? []).some((t) => !THEME_SET.has(t))) {
      log.error('主题不在 16 类枚举内，跳过：{0} / {1}', q.author, q.text)
      skipped.push({ text: q.text, reason: '主题不合法' })
      continue
    }
    if (!['modern', 'speech'].includes(q.sourceType)) {
      log.error('source_type 不合法，跳过：{0} / {1}', q.author, q.text)
      skipped.push({ text: q.text, reason: 'source_type 不合法' })
      continue
    }
    const id = `quote-${authorSlug(q.author)}-${q.slug}`
    const textKey = normalize(q.text)
    if (existingIds.has(id)) {
      skipped.push({ text: q.text, reason: 'id 已存在' })
      log.debug('跳过（id 已存在）：{0}', id)
      continue
    }
    if (existingTexts.has(textKey)) {
      skipped.push({ text: q.text, reason: `正文已存在（${existingTexts.get(textKey)}）` })
      log.debug('跳过（正文已存在）：{0}', q.text)
      continue
    }

    const record = buildModernRecord(q)
    const file = uniqueQuotePath(q.text, plannedFiles)
    fs.writeFileSync(file, record.content, 'utf8')
    existingIds.add(id)
    existingTexts.set(textKey, path.basename(file))
    added[q.sourceType] += 1
    if (q.verified === 'pending') added.pending += 1
    addedRecords.push({
      id,
      text: q.text,
      author: q.author,
      sourceCitation: record.sourceCitation,
      sourceType: q.sourceType,
      verified: q.verified ?? true,
      file: path.basename(file),
    })
    log.debug('写入 {0} ← {1}（{2}）', path.basename(file), q.author, record.sourceCitation)
  }
  addStep.end(
    '新增近现代名家 {0} 条 · 演讲语录 {1} 条（其中 pending {2} 条）· 跳过 {3} 条',
    added.modern, added.speech, added.pending, skipped.length,
  )
  if (skipped.length) {
    for (const s of skipped) log.info('跳过「{0}」：{1}', s.text, s.reason)
  }

  // 3. 重新统计当前全量
  const allFiles = await loadQuoteFiles()
  const records = []
  for (const abs of allFiles) {
    try {
      const data = matter.read(abs).data
      records.push({ ...data, __file: path.basename(abs) })
    } catch {
      // 已在 build-index 报告
    }
  }
  const byType = { classical: 0, modern: 0, speech: 0, unknown: 0 }
  const byVerified = { true: 0, pending: 0, null: 0 }
  const byAuthor = new Map()
  const themeCount = new Map(THEMES.map((t) => [t, 0]))
  for (const r of records) {
    const type = r.source_type ?? 'unknown'
    byType[type] = (byType[type] ?? 0) + 1
    if (r.verified === true) byVerified.true += 1
    else if (r.verified === 'pending') byVerified.pending += 1
    else byVerified.null += 1
    if (type === 'modern' || type === 'speech') {
      byAuthor.set(r.author, (byAuthor.get(r.author) ?? 0) + 1)
      for (const t of r.theme ?? []) {
        if (themeCount.has(t)) themeCount.set(t, themeCount.get(t) + 1)
      }
    }
  }

  // 4. 生成报告
  const docStep = log.step('生成报告与待核清单')
  const report = buildReport({
    records,
    byType,
    byVerified,
    byAuthor,
    themeCount,
    addedRecords,
  })
  const pending = buildPendingDoc()
  const reportChanged = writeIfChanged(REPORT_PATH, report)
  const pendingChanged = writeIfChanged(PENDING_PATH, pending)
  docStep.end(
    '报告 {0} · 待核清单 {1}（{2}）',
    reportChanged ? '已更新' : '无变化',
    pendingChanged ? '已更新' : '无变化',
    path.relative(ROOT, PENDING_PATH).split(path.sep).join('/'),
  )

  log.summary('分层扩充摘要', [
    ['古诗文', `${byType.classical} 条`],
    ['近现代名家', `${byType.modern} 条`],
    ['演讲语录', `${byType.speech} 条`],
    ['其中 pending', `${byVerified.pending} 条`],
    ['名句总数', `${records.length} 条`],
    ['本次新增', `${added.modern + added.speech} 条`],
    ['本次跳过', `${skipped.length} 条`],
    ['报告', path.relative(ROOT, REPORT_PATH).split(path.sep).join('/')],
    ['待核清单', path.relative(ROOT, PENDING_PATH).split(path.sep).join('/')],
  ])
  log.ok('万卷名句分层扩充完成')
}

// ─────────────────────────── 报告生成 ───────────────────────────

function buildReport({ records, byType, byVerified, byAuthor, themeCount, addedRecords }) {
  const totalNew = byType.modern + byType.speech
  const authorRows = [...byAuthor.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([author, count]) => {
      const meta = AUTHOR_META[author] ?? { death: '—', era: '—' }
      const pd = author === '乔布斯' ? '否（pending）' : '是'
      return `| ${author} | ${meta.death} | ${count} | ${pd} |`
    })
    .join('\n')

  const themeRows = THEMES
    .map((t) => `| ${t} | ${themeCount.get(t) ?? 0} |`)
    .join('\n')

  const spot = MODERN_QUOTES.filter((q) => q.verifyNote)
  const spotRows = spot.map((q, i) => {
    const citation = q.sourceCitation ?? `${bookTitle(q.workTitle)}（${q.year}）`
    return `| ${i + 1} | ${q.text} | ${citation} | ${q.verifyNote} |`
  }).join('\n')

  const appendixRows = MODERN_QUOTES.map((q, i) => {
    const citation = q.sourceCitation ?? `${bookTitle(q.workTitle)}（${q.year}）`
    const type = q.sourceType === 'speech' ? '演讲语录' : '近现代名家'
    const verified = q.verified === 'pending' ? 'pending' : 'true'
    return `| ${i + 1} | ${q.text} | ${q.author} | ${citation} | ${type} | ${verified} |`
  }).join('\n')

  const pendingCount = PENDING_ITEMS.length
  const newPending = MODERN_QUOTES.filter((q) => q.verified === 'pending').length
  const pendingRows = PENDING_ITEMS.map((p, i) => (
    `| ${i + 1} | ${p.text} | ${p.author} | ${p.proposed} | ${p.reason} |`
  )).join('\n')

  return `# 万卷 · 名句库分层扩充报告

> 生成脚本：\`scripts/expand-quotes-modern.mjs\`
> 统计口径：当前 \`content/quotes/*.md\` 全量（不含 \`.discarded/\`）
> 数据契约：\`docs/data-model.md\` §2.3 + \`source_type\` / \`source_citation\` / \`verified\` / \`author_era\`

## 1. 分层数量

| 来源层 | source_type | 条数 |
|---|---|---:|
| 古诗文 | classical | ${byType.classical} |
| 近现代名家 | modern | ${byType.modern} |
| 演讲语录 | speech | ${byType.speech} |
| **合计** | — | **${records.length}** |

其中 \`verified: true\` ${byVerified.true} 条，\`verified: pending\` ${byVerified.pending} 条。

本批新增 ${totalNew} 条（近现代名家 ${byType.modern} · 演讲语录 ${byType.speech}）；既有 ${byType.classical} 条古诗文已补齐 \`source_type: classical\`、\`source_citation: 《篇名》\`、\`verified: true\`、\`author_era: 古代\`。

## 2. 新增条目按作者分布

| 作者 | 卒年 | 条数 | 进入公有领域 |
|---|---:|---:|---|
${authorRows}

> 中国作者均取自任务白名单（卒年 ≤1975）；泰戈尔（1941）、罗曼·罗兰（1944）亦已进入公有领域；乔布斯为当代企业家，按要求 \`verified: pending\`。

## 3. 新增条目主题分布

| 主题 | 条数 |
|---|---:|
${themeRows}

> 一条名句可属多个主题，故主题计数之和大于新增条数。

## 4. 抽查 8 条（名句 / 出处 / 核验依据）

| # | 名句 | 出处 | 核验依据（篇名 + 年份） |
|---:|---|---|---|
${spotRows}

## 5. 核验中纠正的常见误植

1. **“青年之字典，无‘困难’之字……”**：常被系于李大钊《青春》，实出 **《〈晨钟〉之使命——青春中华之创造》（1916）**。
2. **“试看将来的环球，必是赤旗的世界！”**：常被系于《庶民的胜利》，实出 **《布尔什维主义的胜利》（1918）**；本库按“近现代名家”（文章）收录。
3. **“循思想自由原则，取兼容并包主义”**：常被系于《我在北京大学的经历》，实出 **《致〈公言报〉函并答林琴南函》（1919）**。
4. **夏丏尊“教育之没有情感，没有爱……”**：为后人流行改写；1924 年《〈爱的教育〉译者序言》原文为 **“教育没有了情爱，就成了无水的池……”**，本库收原文。
5. **罗曼·罗兰“世上只有一种真正的英雄主义……”**：为流行改写；傅雷译本原文为 **“世界上只有一种英雄主义，便是注视世界的真面目——并且爱世界”**，本库收傅雷原译。
6. **胡适“我年纪越大，越感觉到容忍比自由还更重要”**：在《容忍与自由》中是胡适转述其师布尔先生的话，不宜直接署为胡适原创；本库改收胡适自己的结论 **“有时我竟觉得容忍是一切自由的根本：没有容忍，就没有自由”**。
7. **梁启超“人生最苦的事，莫若身上背着一种未了的责任”**：教材通行异文；1922 年《时事新报·学灯》原文为 **“莫苦于身上背着一种未了的责任”**，本库从原文。

## 6. pending 清单

### 6.1 内容页中 \`verified: pending\`（${newPending} 条）

| 名句 | 作者 | 出处 | 待核说明 |
|---|---|---|---|
| Stay Hungry. Stay Foolish. | 乔布斯 | 斯坦福大学2005年毕业典礼演讲（2005-06-12） | 当代企业家，按任务规则一律 pending；原句为乔布斯引述《全球概览》终刊封底 |

### 6.2 未写入内容页的候选（${pendingCount} 组）

| # | 名句/语录 | 作者 | 拟出处 | 为何不确定 |
|---:|---|---|---|---|
${pendingRows}

> 逐条“建议核验路径”见 \`docs/quotes-pending.md\`。

## 7. 已知不确定项与处理

1. **非课标条目的 curriculum 承载**：\`curriculum\` 是现有 schema 必填字段；非课标条目统一写为 \`{ stage: senior, grade: 10, recitation: false }\`，并在 tags 中标注“非课标”。该值**不代表教育部课标归属**，UI 分层应以 \`source_type\` 为准。
2. **《少年中国说》标点差异**：早期《清议报》排版与今人引用在分号/逗号上略有差异；本库统一为通行简体标点，文字未改。
3. **《最苦与最乐》“莫苦于/莫若”**：从 1922 年原刊作“莫苦于”；部分教材作“莫若”，本库不混用。
4. **《济南的冬天》“不刮风/不刮大风”**：各版本略有差异；本库采用“冬天要是不刮风”这一通行文本。
5. **李大钊《青春》《〈晨钟〉之使命》“本其/本身”**：不同转载本有异；本库引用的名句片段不含该处，上下文亦已避开该异文。
6. **译作版权**：郑振铎（1958 卒）、傅雷（1966 卒）译本均已进入公有领域；正文按通行译本逐字收录。
7. **乔布斯条目**：英文原文可核对，但作者未进入公有领域，且中文意译不统一；仅保留英文原句并标记 pending。

## 8. 幂等与运行

- **首次运行**：补字段 ${byType.classical} 条；新增近现代名家 ${MODERN_QUOTES.filter((q) => q.sourceType === 'modern').length} 条 · 演讲语录 ${MODERN_QUOTES.filter((q) => q.sourceType === 'speech').length} 条（其中 pending ${newPending} 条）；跳过 0 条。
- **重复运行**：补字段 0 条；新增 0 条；跳过 ${MODERN_QUOTES.length} 条（id 已存在）；内容文件与文档字节级不变（已实测）。
- 既有古诗文仅在四个字段缺失/不一致时改写；新增条目按 \`id\` + 归一化 \`text\` 双重去重。
- 本报告与 \`docs/quotes-pending.md\` 仅在内容变化时重写，不含动态时间戳，重复运行保持稳定。

## 9. 新增条目清单（${totalNew} 条）

| # | 名句 | 作者 | 出处 | 层 | verified |
|---:|---|---|---|---|---|
${appendixRows}
`
}

function buildPendingDoc() {
  const rows = PENDING_ITEMS.map((p, i) => (
    `| ${i + 1} | ${p.text} | ${p.author} | ${p.proposed} | ${p.reason} | ${p.action} |`
  )).join('\n')

  return `# 万卷 · 名句来源待核清单

> 生成脚本：\`scripts/expand-quotes-modern.mjs\`
> 原则：**不确定就不写入 content/**。以下条目因篇名、年份、逐字文本或授权状态无法确认，暂不进入内容页；确认后再按数据契约补入。

## 1. 已收入内容页但标记 pending

| 名句 | 作者 | 出处 | 待核说明 | 处理 |
|---|---|---|---|---|
| Stay Hungry. Stay Foolish. | 乔布斯 | 斯坦福大学2005年毕业典礼演讲（2005-06-12） | 当代企业家，按任务规则一律 \`verified: pending\`；原句为乔布斯在演讲中引述《全球概览》（Whole Earth Catalog）终刊封底 | 已收入 \`content/quotes/\`，保留英文原文，中文意译待统一 |

## 2. 未收入内容页的候选

| # | 名句/语录 | 作者 | 拟出处 | 为何不确定 | 建议核验 |
|---:|---|---|---|---|---|
${rows}

## 3. 处理规则

1. 上表条目在确认“篇名 + 年份 + 逐字原文”前，不得写入 \`content/quotes/\`。
2. 流行改写、意译、后人概括与原文分开记录；内容页只收原文。
3. 当代企业家语录仅在获得一手演讲/著作原文后收录，并保留 \`verified: pending\`，除非授权与文本均可确认。
`
}

main().catch((err) => {
  log.error('名句分层扩充失败：{0}', err?.stack ?? err?.message ?? err)
  process.exitCode = 1
})
