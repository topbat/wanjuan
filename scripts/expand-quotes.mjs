#!/usr/bin/env node
/**
 * 万卷 · 名句库扩充脚本
 *
 * 目标：把 content/quotes/ 从 8 条扩充到 100-140 条「积极、常用、适合写作引用」的名句。
 *
 * 准确性红线：
 *   - 每条候选名句都必须在本库 content/poems/**\/*.md 的「## 原文」块中逐字命中；
 *   - 校验方式：双方去掉标点/空白后做子串匹配；命中后按原文索引回切，输出语料原文；
 *   - 命中不到的一律丢弃，并在 docs/quotes-report.md 中记录原因。
 *
 * 产物：
 *   - content/quotes/<text 前 8 字>.md（新建/补全）
 *   - docs/quotes-report.md（运行统计、主题分布、丢弃清单）
 *
 * 用法：
 *   node scripts/expand-quotes.mjs [--verbose]
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
const POEMS_DIR = path.join(ROOT, 'content', 'poems')
const QUOTES_DIR = path.join(ROOT, 'content', 'quotes')
const REPORT_PATH = path.join(ROOT, 'docs', 'quotes-report.md')
const DETAIL_PATH = path.join(ROOT, 'site', 'public', 'indexes', 'quotes-detail.json')

const verbose = process.argv.includes('--verbose')
const log = createLogger({ verbose })

/** 主题枚举（固定，作文引用场景） */
const THEMES = [
  '自信', '豁达', '进取', '志向', '家国', '奉献', '思念', '友情',
  '惜时', '勤学', '哲思', '自然', '清廉', '担当', '坚韧', '孝亲',
]
const THEME_SET = new Set(THEMES)

/** 主题 → 适用场景短语（正文与前端卡片共用同一套措辞） */
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

/** 既有名句的旧主题别名（映射到固定枚举；原词保留进 tags） */
const THEME_ALIAS = {
  哲理: '哲思',
  思乡: '思念',
  祝福: '思念',
  壮志: '志向',
  抱负: '志向',
  爱国: '家国',
  炼字: '哲思',
}

/** 既有名句文本校正（只修正与语料不一致的异文，不凭记忆改写） */
const LEGACY_TEXT_FIX = new Map([
  ['春风又绿江南岸，明月何时照我还', '春风自绿江南岸，明月何时照我还'],
])

/** 最终名句总数上限（任务要求 100-140） */
const MAX_TOTAL_QUOTES = 140

/** 是否为需要保留的字符（去掉标点、符号、空白） */
const DROP_CHAR = /[\p{P}\p{S}\s]/u

/**
 * 选条优先级：同一朝代内，优先收录更常用、更适合写作引用的名句。
 * 仅影响「超出总条数上限时谁被留下」，不改变校验结果。
 */
const PRIORITY_PROMOTE = new Set([
  '老当益壮，宁移白首之心？穷且益坚，不坠青云之志',
  '海内存知己，天涯若比邻',
  '独在异乡为异客，每逢佳节倍思亲',
  '大漠孤烟直，长河落日圆',
  '明月松间照，清泉石上流',
  '渭城朝雨浥轻尘，客舍青青柳色新',
  '劝君更尽一杯酒，西出阳关无故人',
  '野火烧不尽，春风吹又生',
  '前不见古人，后不见来者',
  '莫愁前路无知己，天下谁人不识君',
  '同是天涯沦落人，相逢何必曾相识',
  '采得百花成蜜后，为谁辛苦为谁甜',
].map(normalize))

const PRIORITY_DEMOTE = new Set([
  '九曲黄河万里沙，浪淘风簸自天涯',
  '山回路转不见君，雪上空留马行处',
  '江畔何人初见月，江月何年初照人',
  '人生代代无穷已，江月年年秖相似',
  '何当共剪西窗烛，却话巴山夜雨时',
  '我寄愁心与明月，随风直到夜郎西',
  '故人西辞黄鹤楼，烟花三月下扬州',
  '春江潮水连海平，海上明月共潮生',
].map(normalize))

const DYNASTY_ORDER = ['先秦', '汉', '魏晋', '南北朝', '三国', '唐', '五代', '宋', '元', '明', '清', '近现代']
const STAGE_LABEL = { primary: '小学', junior: '初中', senior: '高中' }

// ─────────────────────────── 候选清单（180 条） ───────────────────────────

/** 候选构造器：text / theme / author / work 提示 / 可选 context（必须是原文逐字子串） */
const C = (text, theme, author, work, context) => ({ text, theme, author, work, context })

/*
 * 说明：
 *   - 前 149 条为预期可在语料中命中的候选；
 *   - 后 31 条为常见但本库未收录（或本库版本异文/节选未覆盖）的名句，
 *     用于验证脚本的「逐字校验 + 丢弃」流程，不得进入成品库。
 */
const CANDIDATES = [
  // ── 先秦（24） ──
  C('我善养吾浩然之气', ['担当', '清廉'], '《孟子》', '《孟子》一则'),
  C('舍生而取义者也', ['家国', '担当'], '《孟子》', '《孟子》三则'),
  C('得道者多助，失道者寡助', ['哲思', '家国'], '《孟子》', '《孟子》三则'),
  C('天时不如地利，地利不如人和', ['哲思', '家国'], '《孟子》', '《孟子》三则'),
  C('故天将降大任于是人也，必先苦其心志，劳其筋骨', ['坚韧', '进取'], '《孟子》', '《孟子》三则'),
  C('生于忧患而死于安乐也', ['哲思', '进取'], '《孟子》', '《孟子》三则'),
  C('人恒过，然后能改', ['勤学', '哲思'], '《孟子》', '《孟子》三则'),
  C('鱼，我所欲也；熊掌，亦我所欲也', ['哲思'], '《孟子》', '《孟子》三则'),
  C('日月忽其不淹兮，春与秋其代序', ['惜时'], '屈原', '离骚'),
  C('乘骐骥以驰骋兮，来吾道夫先路', ['进取', '担当'], '屈原', '离骚'),
  C('纷吾既有此内美兮，又重之以修能', ['勤学', '自信'], '屈原', '离骚'),
  C('一鼓作气，再而衰，三而竭', ['哲思', '坚韧'], '《左传》', '曹刿论战'),
  C('群臣吏民能面刺寡人之过者，受上赏', ['清廉', '担当'], '《战国策》', '邹忌讽齐王纳谏'),
  C('文质彬彬，然后君子', ['勤学', '哲思'], '《论语》', '《论语》十二章'),
  C('己所不欲，勿施于人', ['哲思', '清廉'], '《论语》', '《论语》十二章'),
  C('君子食无求饱，居无求安，敏于事而慎于言', ['勤学', '清廉'], '《论语》', '《论语》十二章'),
  C('暮春者，春服既成，冠者五六人，童子六七人，浴乎沂，风乎舞雩，咏而归', ['自然', '豁达'], '《论语》', '子路、曾晳、冉有、公西华侍坐'),
  C('不患寡而患不均，不患贫而患不安', ['家国', '哲思'], '《论语》', '季氏将伐颛臾'),
  C('远人不服则修文德以来之', ['家国', '担当'], '《论语》', '季氏将伐颛臾'),
  C('陈力就列，不能者止', ['担当', '清廉'], '《论语》', '季氏将伐颛臾'),
  C('关关雎鸠，在河之洲', ['自然', '思念'], '《诗经》', '关雎'),
  C('蒹葭苍苍，白露为霜', ['自然', '思念'], '《诗经》', '蒹葭'),
  C('所谓伊人，在水一方', ['思念', '自然'], '《诗经》', '蒹葭'),
  C('溯洄从之，道阻且长', ['坚韧', '进取'], '《诗经》', '蒹葭'),

  // ── 汉（7） ──
  C('对酒当歌，人生几何！譬如朝露，去日苦多', ['惜时', '豁达'], '曹操', '短歌行'),
  C('山不厌高，海不厌深', ['豁达', '志向', '勤学'], '曹操', '短歌行'),
  C('周公吐哺，天下归心', ['家国', '担当'], '曹操', '短歌行'),
  C('东临碣石，以观沧海', ['自然', '志向'], '曹操', '观沧海'),
  C('日月之行，若出其中；星汉灿烂，若出其里', ['自然', '志向', '豁达'], '曹操', '观沧海'),
  C('究天人之际，通古今之变，成一家之言', ['志向', '勤学', '哲思'], '司马迁', '报任安书'),
  C('其文约，其辞微，其志洁，其行廉', ['清廉', '哲思'], '司马迁', '屈原列传'),

  // ── 魏晋（9） ──
  C('臣无祖母，无以至今日，祖母无臣，无以终余年', ['孝亲'], '李密', '陈情表'),
  C('乌鸟私情，愿乞终养', ['孝亲'], '李密', '陈情表'),
  C('群贤毕至，少长咸集', ['友情'], '王羲之', '兰亭集序'),
  C('此地有崇山峻岭，茂林修竹', ['自然'], '王羲之', '兰亭集序'),
  C('天朗气清，惠风和畅', ['自然', '豁达'], '王羲之', '兰亭集序'),
  C('仰观宇宙之大，俯察品类之盛', ['哲思', '自然'], '王羲之', '兰亭集序'),
  C('芳草鲜美，落英缤纷', ['自然'], '陶潜', '桃花源记'),
  C('复行数十步，豁然开朗', ['自然', '哲思'], '陶潜', '桃花源记'),
  C('黄发垂髫，并怡然自乐', ['孝亲', '自然', '豁达'], '陶潜', '桃花源记'),

  // ── 三国（1） ──
  C('受任于败军之际，奉命于危难之间', ['担当', '家国'], '诸葛亮', '出师表'),

  // ── 唐（66） ──
  C('九曲黄河万里沙，浪淘风簸自天涯', ['自然', '进取'], '刘禹锡', '浪淘沙'),
  C('沈舟侧畔千帆过，病树前头万木春', ['豁达', '进取'], '刘禹锡', '酬乐天扬州初逢席上见赠'),
  C('山不在高，有仙则名', ['哲思', '清廉'], '刘禹锡', '陋室铭'),
  C('斯是陋室，惟吾德馨', ['清廉', '豁达'], '刘禹锡', '陋室铭'),
  C('谈笑有鸿儒，往来无白丁', ['勤学', '友情'], '刘禹锡', '陋室铭'),
  C('春眠不觉晓，处处闻啼鸟', ['自然'], '孟浩然', '春晓'),
  C('慈母手中线，游子身上衣', ['孝亲'], '孟郊', '游子吟'),
  C('谁言寸草心，报得三春晖', ['孝亲'], '孟郊', '游子吟'),
  C('忽然一夜春风来，千树万树梨花开', ['自然', '豁达'], '岑参', '白雪歌送武判官归京'),
  C('山回路转不见君，雪上空留马行处', ['友情', '思念'], '岑参', '白雪歌送武判官归京'),
  C('黄鹤一去不复返，白云千载空悠悠', ['哲思', '自然'], '崔颢', '黄鹤楼'),
  C('日暮乡关何处是，烟波江上使人愁', ['思念'], '崔颢', '黄鹤楼'),
  C('月落乌啼霜满天，江枫渔父对愁眠', ['自然', '思念'], '张继', '枫桥夜泊'),
  C('姑苏城外寒山寺，夜半钟声到客船', ['自然', '思念'], '张继', '枫桥夜泊'),
  C('春江潮水连海平，海上明月共潮生', ['自然'], '张若虚', '春江花月夜'),
  C('江畔何人初见月，江月何年初照人', ['哲思'], '张若虚', '春江花月夜'),
  C('人生代代无穷已，江月年年秖相似', ['哲思', '惜时'], '张若虚', '春江花月夜'),
  C('君问归期未有期，巴山夜雨涨秋池', ['思念'], '李商隐', '夜雨寄北'),
  C('何当共剪西窗烛，却话巴山夜雨时', ['思念', '友情'], '李商隐', '夜雨寄北'),
  C('春蚕到死丝方尽，蜡炬成灰泪始干', ['奉献'], '李商隐', '无题'),
  C('锦瑟无端五十弦，一弦一柱思华年', ['惜时'], '李商隐', '锦瑟'),
  C('此情可待成追忆，只是当时已惘然', ['惜时', '哲思'], '李商隐', '锦瑟'),
  C('小时不识月，呼作白玉盘', ['自然', '思念'], '李白', '古朗月行'),
  C('君不见黄河之水天上来，奔流到海不复回', ['惜时', '豁达'], '李白', '将进酒'),
  C('人生得意须尽欢，莫使金樽空对月', ['豁达'], '李白', '将进酒'),
  C('千金散尽还复来', ['豁达', '自信'], '李白', '将进酒'),
  C('朝辞白帝彩云间，千里江陵一日还', ['豁达', '自然'], '李白', '早发白帝城'),
  C('轻舟已过万重山', ['豁达', '进取'], '李白', '早发白帝城'),
  C('飞流直下三千尺，疑是银河落九天', ['自然'], '李白', '望庐山瀑布'),
  C('安能摧眉折腰事权贵，使我不得开心颜', ['清廉', '自信', '担当'], '李白', '梦游天姥吟留别'),
  C('长风破浪会有时，直挂云帆济沧海', ['自信', '进取', '志向'], '李白', '行路难'),
  C('桃花潭水深千尺，不及汪伦送我情', ['友情'], '李白', '赠汪伦'),
  C('我寄愁心与明月，随风直到夜郎西', ['友情', '思念'], '李白', '闻王昌龄左迁龙标遥有此寄'),
  C('床前明月光，疑是地上霜', ['思念'], '李白', '静夜思'),
  C('举头望明月，低头思故乡', ['思念'], '李白', '静夜思'),
  C('故人西辞黄鹤楼，烟花三月下扬州', ['友情', '自然'], '李白', '黄鹤楼送孟浩然之广陵'),
  C('停车坐爱枫林晚，霜叶红于二月花', ['自然', '哲思'], '杜牧', '山行'),
  C('好雨知时节，当春乃发生', ['自然', '奉献'], '杜甫', '春夜喜雨'),
  C('随风潜入夜，润物细无声', ['奉献', '自然'], '杜甫', '春夜喜雨'),
  C('无边落木萧萧下，不尽长江衮衮来', ['自然', '哲思'], '杜甫', '登高'),
  C('安得广厦千万间，大庇天下寒士俱欢颜', ['家国', '担当', '奉献'], '杜甫', '茅屋为秋风所破歌'),
  C('千山鸟飞绝，万径人踪灭', ['自然'], '柳宗元', '江雪'),
  C('孤舟蓑笠翁，独钓寒江雪', ['自然', '坚韧', '清廉'], '柳宗元', '江雪'),
  C('黄河远上白云间，一片孤城万仞山', ['自然', '家国'], '王之涣', '凉州词'),
  C('羌笛何须怨杨柳，春风不度玉门关', ['自然', '家国'], '王之涣', '凉州词'),
  C('落霞与孤鹜齐飞，秋水共长天一色', ['自然'], '王勃', '滕王阁序'),
  C('老当益壮，宁移白首之心？穷且益坚，不坠青云之志', ['坚韧', '进取', '志向'], '王勃', '滕王阁序'),
  C('海内存知己，天涯若比邻', ['友情'], '王勃', '送杜少府之任蜀州'),
  C('独在异乡为异客，每逢佳节倍思亲', ['思念', '孝亲'], '王维', '九月九日忆山东兄弟'),
  C('大漠孤烟直，长河落日圆', ['自然'], '王维', '使至塞上'),
  C('明月松间照，清泉石上流', ['自然'], '王维', '山居秋暝'),
  C('渭城朝雨浥轻尘，客舍青青柳色新', ['友情', '自然'], '王维', '送元二使安西'),
  C('劝君更尽一杯酒，西出阳关无故人', ['友情'], '王维', '送元二使安西'),
  C('野火烧不尽，春风吹又生', ['坚韧', '自然'], '白居易', '赋得古原草送别'),
  C('采得百花成蜜后，为谁辛苦为谁甜', ['奉献', '哲思'], '罗隐', '蜂'),
  C('不知细叶谁裁出，二月春风似剪刀', ['自然'], '贺知章', '咏柳'),
  C('少小离家老大回，乡音难改鬓毛衰', ['思念', '惜时'], '贺知章', '回乡偶书'),
  C('只在此山中，云深不知处', ['自然', '哲思'], '贾岛', '寻隐者不遇'),
  C('前不见古人，后不见来者', ['哲思', '惜时'], '陈子昂', '登幽州台歌'),
  C('莫愁前路无知己，天下谁人不识君', ['友情', '自信'], '高适', '别董大'),
  C('三人行，则必有我师', ['勤学'], '韩愈', '师说'),
  C('闻道有先后，术业有专攻', ['勤学', '哲思'], '韩愈', '师说'),
  C('千呼万唤始出来，犹抱琵琶半遮面', ['哲思'], '白居易', '琵琶行（并序）'),
  C('同是天涯沦落人，相逢何必曾相识', ['友情', '思念'], '白居易', '琵琶行（并序）'),
  C('大弦嘈嘈如急雨，小弦切切如私语', ['自然'], '白居易', '琵琶行（并序）'),
  C('葡萄美酒夜光杯，欲饮琵琶马上催', ['家国', '豁达'], '王翰', '凉州词'),

  // ── 宋（37） ──
  C('竹外桃花三两枝，春江水暖鸭先知', ['自然'], '苏轼', '惠崇春江晚景'),
  C('欲把西湖比西子，淡妆浓抹总相宜', ['自然'], '苏轼', '饮湖上初晴后雨'),
  C('横看成岭侧成峰，远近高低总不同', ['哲思'], '苏轼', '题西林壁'),
  C('大江东去，浪淘尽，千古风流人物', ['哲思', '豁达'], '苏轼', '念奴娇·赤壁怀古'),
  C('乱石穿空，惊涛拍岸，卷起千堆雪', ['自然'], '苏轼', '念奴娇·赤壁怀古'),
  C('江山如画，一时多少豪杰', ['自然', '家国', '豁达'], '苏轼', '念奴娇·赤壁怀古'),
  C('人生如梦，一尊还酹江月', ['豁达', '哲思'], '苏轼', '念奴娇·赤壁怀古'),
  C('明月几时有？把酒问青天', ['思念', '哲思'], '苏轼', '水调歌头·明月几时有'),
  C('我欲乘风归去，又恐琼楼玉宇，高处不胜寒', ['哲思', '豁达'], '苏轼', '水调歌头·明月几时有'),
  C('人有悲欢离合，月有阴晴圆缺，此事古难全', ['哲思', '豁达'], '苏轼', '水调歌头·明月几时有'),
  C('清风徐来，水波不兴', ['自然', '豁达'], '苏轼', '赤壁赋'),
  C('纵一苇之所如，凌万顷之茫然', ['豁达', '自然'], '苏轼', '赤壁赋'),
  C('寄蜉蝣于天地，渺沧海之一粟', ['哲思'], '苏轼', '赤壁赋'),
  C('哀吾生之须臾，羡长江之无穷', ['哲思', '惜时'], '苏轼', '赤壁赋'),
  C('逝者如斯，而未尝往也；盈虚者如彼，而卒莫消长也', ['哲思'], '苏轼', '赤壁赋'),
  C('惟江上之清风，与山间之明月，耳得之而为声，目遇之而成色', ['自然', '豁达'], '苏轼', '赤壁赋'),
  C('山重水复疑无路，柳暗花明又一村', ['坚韧', '哲思', '进取'], '陆游', '游山西村'),
  C('王师北定中原日，家祭无忘告乃翁', ['家国', '孝亲'], '陆游', '示儿'),
  C('不畏浮云遮望眼，自缘身在最高层', ['志向', '自信', '哲思'], '王安石', '登飞来峰'),
  C('爆竹声中一岁除，东风送暖入屠苏', ['自然'], '王安石', '元日'),
  C('先天下之忧而忧，后天下之乐而乐', ['家国', '担当', '奉献'], '范仲淹', '岳阳楼记'),
  C('不以物喜，不以己悲', ['豁达', '清廉'], '范仲淹', '岳阳楼记'),
  C('居庙堂之高则忧其民；处江湖之远则忧其君', ['家国', '担当'], '范仲淹', '岳阳楼记'),
  C('醉翁之意不在酒，在乎山水之间也', ['豁达', '自然'], '欧阳修', '醉翁亭记'),
  C('忧劳可以兴国，逸豫可以亡身', ['清廉', '担当', '哲思'], '欧阳修', '五代史伶官传序'),
  C('无可奈何花落去，似曾相识燕归来', ['哲思', '惜时'], '晏殊', '浣溪沙'),
  C('问渠那得清如许，为有源头活水来', ['勤学', '哲思'], '朱熹', '观书有感'),
  C('等闲识得东风面，万紫千红总是春', ['自然', '哲思'], '朱熹', '春日'),
  C('春色满园关不住，一枝红杏出墙来', ['自然', '哲思'], '叶绍翁', '游园不值'),
  C('小荷才露尖尖角，早有蜻蜓立上头', ['自然', '进取'], '杨万里', '小池'),
  C('众里寻他千百度，蓦然回首，那人却在，灯火阑珊处', ['哲思', '勤学', '进取'], '辛弃疾', '青玉案·元夕'),
  C('醉里挑灯看剑，梦回吹角连营', ['家国', '志向'], '辛弃疾', '破阵子'),
  C('想当年，金戈铁马，气吞万里如虎', ['家国', '志向'], '辛弃疾', '永遇乐·京口北固亭怀古'),
  C('人生自古谁无死，留取丹心照汗青', ['家国', '担当', '奉献'], '文天祥', '过零丁洋'),
  C('生当为人杰，死亦作鬼雄', ['家国', '担当', '志向'], '李清照', '夏日绝句'),
  C('九万里风鹏正举', ['志向', '进取'], '李清照', '渔家傲'),
  C('两情若是长久时，又岂在、朝朝暮暮', ['思念', '哲思'], '秦观', '鹊桥仙'),

  // ── 元（4） ──
  C('枯藤老树昏鸦，小桥流水人家，古道西风瘦马', ['自然', '思念'], '马致远', '天净沙·秋思'),
  C('夕阳西下，断肠人在天涯', ['思念', '自然'], '马致远', '天净沙·秋思'),
  C('峰峦如聚，波涛如怒，山河表里潼关路', ['自然', '家国'], '张养浩', '山坡羊·潼关怀古',
    '峰峦如聚，波涛如怒，山河表里潼关路。望西都，意踌蹰，伤心秦汉经行处，宫阙万间都做了土。'),
  C('兴，百姓苦；亡，百姓苦', ['家国', '哲思'], '张养浩', '山坡羊·潼关怀古'),

  // ── 清（1） ──
  C('浩荡离愁白日斜，吟鞭东指即天涯', ['思念', '志向'], '龚自珍', '己亥杂诗·其五'),

  // ── 预期丢弃：本库未收录 / 节选未覆盖 / 异文（31） ──
  C('路漫漫其修远兮，吾将上下而求索', ['进取', '坚韧'], '屈原', '离骚'),
  C('长太息以掩涕兮，哀民生之多艰', ['家国'], '屈原', '离骚'),
  C('亦余心之所善兮，虽九死其犹未悔', ['坚韧', '志向'], '屈原', '离骚'),
  C('富贵不能淫，贫贱不能移，威武不能屈', ['清廉', '坚韧'], '《孟子》', '《孟子》三则'),
  C('老吾老以及人之老，幼吾幼以及人之幼', ['孝亲'], '《孟子》', '《孟子》三则'),
  C('天行健，君子以自强不息', ['进取', '坚韧'], '《周易》', '周易'),
  C('地势坤，君子以厚德载物', ['豁达', '担当'], '《周易》', '周易'),
  C('见贤思齐焉，见不贤而内自省也', ['勤学', '哲思'], '《论语》', '《论语》十二章'),
  C('逝者如斯夫，不舍昼夜', ['惜时'], '《论语》', '《论语》十二章'),
  C('三人行，必有我师焉', ['勤学'], '《论语》', '《论语》十二章'),
  C('学而不思则罔，思而不学则殆', ['勤学'], '《论语》', '《论语》十二章'),
  C('温故而知新，可以为师矣', ['勤学'], '《论语》', '《论语》十二章'),
  C('岁寒，然后知松柏之后凋也', ['坚韧'], '《论语》', '《论语》十二章'),
  C('朝闻道，夕死可矣', ['勤学', '哲思'], '《论语》', '《论语》十二章'),
  C('三军可夺帅也，匹夫不可夺志也', ['志向', '坚韧'], '《论语》', '《论语》十二章'),
  C('吾生也有涯，而知也无涯', ['勤学', '哲思'], '庄子', '庄子'),
  C('千里之行，始于足下', ['进取', '勤学'], '老子', '道德经'),
  C('上善若水，水善利万物而不争', ['清廉', '豁达'], '老子', '道德经'),
  C('祸兮福之所倚，福兮祸之所伏', ['哲思', '豁达'], '老子', '道德经'),
  C('青，取之于蓝，而青于蓝', ['勤学', '进取'], '荀子', '劝学'),
  C('锲而不舍，金石可镂', ['坚韧', '勤学'], '荀子', '劝学'),
  C('不积跬步，无以至千里', ['勤学', '坚韧'], '荀子', '劝学'),
  C('鞠躬尽瘁，死而后已', ['奉献', '担当'], '诸葛亮', '后出师表'),
  C('燕雀安知鸿鹄之志哉', ['志向', '自信'], '司马迁', '陈涉世家'),
  C('王侯将相宁有种乎', ['志向', '家国'], '司马迁', '陈涉世家'),
  C('人固有一死，或重于泰山，或轻于鸿毛', ['家国', '担当'], '司马迁', '报任安书'),
  C('桃李不言，下自成蹊', ['清廉', '担当'], '司马迁', '李将军列传'),
  C('忠言逆耳利于行，良药苦口利于病', ['清廉', '哲思'], '司马迁', '史记'),
  C('前事不忘，后事之师', ['哲思', '家国'], '《战国策》', '赵策'),
  C('塞翁失马，焉知非福', ['豁达', '哲思'], '《淮南子》', '人间训'),
  C('读书破万卷，下笔如有神', ['勤学'], '杜甫', '奉赠韦左丞丈二十二韵'),
]

// ─────────────────────────── 工具函数 ───────────────────────────

/** 去掉标点/空白，用于逐字比对 */
function normalize(text) {
  let out = ''
  for (const ch of String(text ?? '')) {
    if (!DROP_CHAR.test(ch)) out += ch
  }
  return out
}

/** 归一化并记录每个归一化字符在原文中的索引（按 UTF-16 码元对齐，兼容非 BMP 字） */
function normalizeWithMap(text) {
  let norm = ''
  const map = []
  let i = 0
  for (const ch of String(text ?? '')) {
    if (!DROP_CHAR.test(ch)) {
      norm += ch
      for (let k = 0; k < ch.length; k += 1) map.push(i + k)
    }
    i += ch.length
  }
  return { norm, map }
}

/** 从正文提取「## 原文」块（止于下一个标题或引用块） */
function extractOriginal(content) {
  const lines = String(content ?? '').split(/\r?\n/)
  const idx = lines.findIndex((l) => /^##\s*原文\s*$/.test(l.trim()))
  const slice = idx >= 0 ? lines.slice(idx + 1) : lines
  const body = []
  for (const line of slice) {
    if (/^##\s/.test(line)) break
    if (line.trim().startsWith('>')) break
    body.push(line)
  }
  return body.join('\n').trim()
}

/** 加载全部作品，建立正文归一化索引 */
async function loadPoems() {
  const files = await fg('**/*.md', { cwd: POEMS_DIR, absolute: true })
  const poems = []
  for (const abs of files) {
    const parsed = matter.read(abs)
    const body = extractOriginal(parsed.content)
    if (!body) {
      log.warn('作品缺少「## 原文」块，跳过：{0}', path.relative(ROOT, abs))
      continue
    }
    const { norm, map } = normalizeWithMap(body)
    poems.push({
      id: parsed.data.id,
      title: parsed.data.title,
      author: parsed.data.author,
      dynasty: parsed.data.dynasty,
      form: parsed.data.form,
      genre: parsed.data.genre,
      tags: parsed.data.tags ?? [],
      curriculum: parsed.data.curriculum,
      body,
      norm,
      map,
      srcPath: path.relative(ROOT, abs).split(path.sep).join('/'),
    })
  }
  return poems
}

/** 在作品中定位候选文本；同时校验作者/篇名提示（提示不匹配则丢弃） */
function locateInPoems(poems, text, hint = {}) {
  const norm = normalize(text)
  if (!norm) return { reason: '候选文本为空' }

  let pool = poems.filter((p) => p.norm.includes(norm))
  if (!pool.length) {
    const where = [hint.author, hint.work].filter(Boolean).join('《').replace(/《([^《]+)$/, '《$1》')
    return { reason: `正文未命中（去除标点后未在任何作品「## 原文」中找到${where ? `；提示出处：${where}` : ''}）` }
  }

  if (hint.work) {
    const byWork = pool.filter((p) => p.title === hint.work || p.title.startsWith(`${hint.work}·`) || hint.work.startsWith(`${p.title}·`))
    if (byWork.length) pool = byWork
    else return { reason: `文本在库中命中，但与提示篇名「${hint.work}」不符（命中：${pool.map((p) => `《${p.title}》`).join('、')}）` }
  }
  if (hint.author) {
    const byAuthor = pool.filter((p) => p.author === hint.author)
    if (byAuthor.length) pool = byAuthor
    else return { reason: `文本在库中命中，但与提示作者「${hint.author}」不符（命中：${pool.map((p) => `${p.author}《${p.title}》`).join('、')}）` }
  }
  if (!pool.length) return { reason: '提示作者/篇名与库中作品不匹配' }

  // 同一文本命中多篇时取第一首，并在详细日志中提示
  if (pool.length > 1) log.debug('候选「{0}」命中 {1} 篇，取《{2}》', text, pool.length, pool[0].title)
  const poem = pool[0]
  const idx = poem.norm.indexOf(norm)
  const start = poem.map[idx]
  const end = poem.map[idx + norm.length - 1] + 1
  return { poem, start, end, rawText: poem.body.slice(start, end).replace(/\s+/g, '') }
}

/** 把正文切成句子单元（含标点；行尾逗号保留为未完结单元） */
function buildUnits(body) {
  const units = []
  let offset = 0
  for (const line of body.split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    if (!line.trim()) continue
    const re = /[^。！？；\n]+[。！？；]?[」』”’）】》]*/g
    let m
    while ((m = re.exec(line))) {
      const text = m[0]
      if (!text.trim()) continue
      units.push({ start: lineStart + m.index, end: lineStart + m.index + text.length, text })
    }
  }
  return units
}

/** 语境清洗：去掉行内空白，保留换行（诗行） */
function cleanContext(text) {
  return String(text ?? '').replace(/\r/g, '').replace(/[ \t\u3000]+/g, '').trim()
}

/** 取包含名句的「相关两句」：优先整句；未完结（逗号/分号）时补下一句 */
function extractContext(poem, start, end, override) {
  if (override) {
    const norm = normalize(override)
    if (norm.includes(normalize(poem.body.slice(start, end))) && poem.norm.includes(norm)) {
      return cleanContext(override)
    }
    log.warn('候选语境覆盖未通过逐字校验，改用自动截取：《{0}》', poem.title)
  }

  const units = buildUnits(poem.body)
  const hit = units
    .map((u, i) => ({ ...u, i }))
    .filter((u) => u.start < end && u.end > start)
  if (!hit.length) return poem.body.slice(start, end)

  let first = hit[0].i
  let last = hit[hit.length - 1].i
  // 句末仍为逗号/分号/冒号时继续补句，保证语境是完整的两句（最多补 2 个单元）
  let guard = 0
  while (last < units.length - 1 && /[，、：；]$/.test(units[last].text.trim()) && guard < 2) {
    last += 1
    guard += 1
  }
  const lastUnit = units[last]
  if (first === last && lastUnit.text.trim().length < 12 && units[last + 1]) last += 1

  const context = poem.body.slice(units[first].start, units[last].end).trim()
  return cleanContext(context || poem.body.slice(start, end))
}

/** 主题 → 适用场景一句话 */
function sceneFor(themes) {
  const names = themes.map((t) => `「${t}」`).join('、')
  const desc = themes.map((t) => THEME_SCENE[t]).filter(Boolean).join('；')
  return `适合用于${names}主题的写作：${desc}。`
}

/** 书名号：篇名本身已带书名号时不重复包裹 */
function bookTitle(title) {
  return /^《.*》/.test(title) ? title : `《${title}》`
}

/** YAML 标量（双引号 + JSON 转义） */
function yamlString(text) {
  return JSON.stringify(String(text))
}

/** 生成唯一 id */
function makeId(text, used) {
  const plain = normalize(text)
  const syllables = pinyin(plain, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .filter((s) => s && s.trim())
  const base = `quote-${syllables.slice(0, 10).join('-') || 'unnamed'}`
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

/** 文件名：去掉标点后取前 8 字 */
function firstChars(text, n = 8) {
  const plain = normalize(text)
  return [...plain].slice(0, n).join('') || '名句'
}

/** 生成唯一文件路径（不覆盖既有名句文件） */
function uniqueQuotePath(text, existingFiles) {
  const base = firstChars(text)
  let name = `${base}.md`
  let n = 2
  while (fs.existsSync(path.join(QUOTES_DIR, name)) || existingFiles.has(name)) {
    name = `${base}-${n++}.md`
  }
  existingFiles.add(name)
  return path.join(QUOTES_DIR, name)
}

/** 组装一条名句数据（frontmatter + 正文） */
function buildQuoteRecord({ id, poem, rawText, themes, tags, context }) {
  const curriculum = poem.curriculum
  if (!curriculum || !['primary', 'junior', 'senior'].includes(curriculum.stage) || !Number.isInteger(curriculum.grade)) {
    throw new Error(`作品《${poem.title}》缺少合法 curriculum，无法生成名句`)
  }
  const body = [
    '# 名句',
    '',
    '## 出处',
    '',
    `${bookTitle(poem.title)}·${poem.author}（${poem.dynasty}）`,
    '',
    '## 语境',
    '',
    context,
    '',
    '## 适用场景',
    '',
    sceneFor(themes),
    '',
  ].join('\n')

  const frontmatter = [
    '---',
    `id: ${yamlString(id)}`,
    `text: ${yamlString(rawText)}`,
    `author: ${yamlString(poem.author)}`,
    `work: ${yamlString(poem.id)}`,
    `theme: [${themes.map((t) => yamlString(t)).join(', ')}]`,
    `dynasty: ${yamlString(poem.dynasty)}`,
    `curriculum: { stage: ${curriculum.stage}, grade: ${curriculum.grade}, recitation: ${Boolean(curriculum.recitation)} }`,
    `tags: [${tags.map((t) => yamlString(t)).join(', ')}]`,
    '---',
    '',
  ].join('\n')

  return { frontmatter, body, content: frontmatter + body }
}

/** 主题清洗：只保留固定枚举，旧词映射/降级到 tags */
function normalizeThemes(list) {
  const themes = []
  const legacy = []
  for (const raw of list ?? []) {
    const t = THEME_ALIAS[raw] ?? raw
    if (THEME_SET.has(t)) {
      if (!themes.includes(t)) themes.push(t)
    } else {
      legacy.push(raw)
    }
  }
  if (!themes.length) themes.push('哲思')
  return { themes: themes.slice(0, 3), legacy }
}

/** 合并 tags（去重、保序） */
function mergeTags(...lists) {
  const out = []
  for (const list of lists) {
    for (const t of list ?? []) {
      const v = String(t ?? '').trim()
      if (v && !out.includes(v)) out.push(v)
    }
  }
  return out
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  const startedAt = Date.now()
  log.info('万卷名句库扩充启动（候选清单 → 逐字校验 → 生成 content/quotes/）')

  fs.mkdirSync(QUOTES_DIR, { recursive: true })

  const loadStep = log.step('加载作品语料')
  const poems = await loadPoems()
  if (!poems.length) {
    log.error('未加载到任何作品，请检查 content/poems/**/*.md')
    return
  }
  loadStep.end('加载作品 {0} 篇（已建立「## 原文」归一化索引）', poems.length)

  // 既有名句
  const existingStep = log.step('补全既有名句')
  const existingFiles = fs.existsSync(QUOTES_DIR)
    ? fg.sync('*.md', { cwd: QUOTES_DIR, absolute: true, dot: false })
    : []
  const usedIds = new Set()
  const activeTexts = new Set()
  const existingRecords = []
  const existingNotes = []
  const archived = []
  const existingNameSet = new Set(existingFiles.map((f) => path.basename(f)))

  for (const abs of existingFiles) {
    const base = path.basename(abs)
    let parsed
    try {
      parsed = matter.read(abs)
    } catch (err) {
      log.error('既有名句解析失败 {0}：{1}', base, err.message)
      continue
    }
    const data = parsed.data
    if (!data?.text) {
      log.warn('既有名句缺少 text，跳过：{0}', base)
      continue
    }

    const originalText = data.text
    const fixedText = LEGACY_TEXT_FIX.get(originalText) ?? originalText
    const located = locateInPoems(poems, fixedText)
    if (!located.poem) {
      // 未通过语料校验：移出活动目录（仍保留在 .discarded 供审计）
      const discardDir = path.join(QUOTES_DIR, '.discarded')
      fs.mkdirSync(discardDir, { recursive: true })
      const target = path.join(discardDir, base)
      const finalTarget = fs.existsSync(target)
        ? path.join(discardDir, `${path.parse(base).name}-${Date.now()}${path.extname(base)}`)
        : target
      fs.renameSync(abs, finalTarget)
      archived.push({ file: base, text: originalText, reason: located.reason })
      log.warn('既有名句未通过逐字校验，已移至 content/quotes/.discarded/：{0}（{1}）', base, located.reason)
      continue
    }

    const { poem } = located
    const { themes, legacy } = normalizeThemes(data.theme)
    const existingTags = Array.isArray(data.tags) ? data.tags : []
    const tags = mergeTags(existingTags, ['作文素材'], poem.curriculum?.recitation ? ['课标必背'] : [], legacy)
    const id = data.id || makeId(fixedText, usedIds)
    usedIds.add(id)

    // 语境：既有名句也统一从语料重截
    const context = extractContext(poem, located.start, located.end)

    const record = buildQuoteRecord({
      id,
      poem,
      rawText: located.rawText,
      themes,
      tags,
      context,
    })

    if (fixedText !== originalText) {
      existingNotes.push(`文本校正：${originalText} → ${located.rawText}（依据《${poem.title}》原文）`)
      log.warn('既有名句文本校正：{0} → {1}', originalText, located.rawText)
    }
    if (data.work && data.work !== poem.id) {
      existingNotes.push(`work 修正：${data.work} → ${poem.id}`)
    }
    if (legacy.length) {
      existingNotes.push(`旧主题词保留进 tags：${legacy.join('、')}`)
    }

    fs.writeFileSync(abs, record.content, 'utf8')
    activeTexts.add(normalize(located.rawText))
    existingRecords.push({
      id,
      text: located.rawText,
      author: poem.author,
      dynasty: poem.dynasty,
      themes,
      stage: poem.curriculum.stage,
      file: base,
      poem,
      context,
    })
    log.ok('补全既有名句：{0}（work={1}）', located.rawText, poem.id)
  }
  existingStep.end('补全既有名句 {0} 条（归档未通过校验 {1} 条）', existingRecords.length, archived.length)

  // 候选校验
  const checkStep = log.step('校验候选名句')
  const valid = []
  const discarded = []
  const duplicates = []
  for (const cand of CANDIDATES) {
    const located = locateInPoems(poems, cand.text, cand)
    if (!located.poem) {
      discarded.push({ text: cand.text, hint: `${cand.author}《${cand.work}》`, reason: located.reason })
      log.warn('丢弃候选「{0}」：{1}', cand.text, located.reason)
      continue
    }
    const key = normalize(located.rawText)
    if (activeTexts.has(key)) {
      duplicates.push({ text: located.rawText, hint: `${located.poem.author}《${located.poem.title}》`, reason: '与已收录名句重复' })
      log.info('跳过重复候选「{0}」（已收录）', located.rawText)
      continue
    }
    activeTexts.add(key)
    const { themes } = normalizeThemes(cand.theme)
    const context = extractContext(located.poem, located.start, located.end, cand.context)
    valid.push({ ...located, themes, context, candidate: cand })
  }
  checkStep.end('候选 {0} 条：校验通过 {1} 条 · 丢弃 {2} 条 · 重复 {3} 条', CANDIDATES.length, valid.length, discarded.length, duplicates.length)

  // 按朝代轮转选取，保证朝代覆盖，再受总条数上限约束
  const newLimit = Math.max(0, MAX_TOTAL_QUOTES - existingRecords.length)
  const groups = new Map(DYNASTY_ORDER.map((d) => [d, []]))
  for (const item of valid) {
    const d = item.poem.dynasty
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d).push(item)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const pa = PRIORITY_PROMOTE.has(normalize(a.rawText)) ? 0 : PRIORITY_DEMOTE.has(normalize(a.rawText)) ? 2 : 1
      const pb = PRIORITY_PROMOTE.has(normalize(b.rawText)) ? 0 : PRIORITY_DEMOTE.has(normalize(b.rawText)) ? 2 : 1
      return pa - pb || CANDIDATES.indexOf(a.candidate) - CANDIDATES.indexOf(b.candidate)
    })
  }
  const selected = []
  const skippedByLimit = []
  let round = 0
  while (selected.length < newLimit) {
    let picked = false
    for (const d of groups.keys()) {
      const list = groups.get(d)
      if (round < list.length) {
        if (selected.length < newLimit) {
          selected.push(list[round])
          picked = true
        } else {
          skippedByLimit.push(list[round])
        }
      }
    }
    if (!picked) break
    round += 1
  }
  for (const list of groups.values()) {
    for (const item of list.slice(round)) skippedByLimit.push(item)
  }

  // 生成新名句
  const genStep = log.step('生成名句文件')
  let generated = 0
  const generatedRecords = []
  const fileSet = new Set(existingFiles.map((f) => path.basename(f)))
  for (const item of selected) {
    const id = makeId(item.rawText, usedIds)
    const tags = mergeTags(['作文素材'], item.poem.curriculum?.recitation ? ['课标必背'] : [], item.poem.genre && item.poem.genre !== '待归类' ? [item.poem.genre] : [])
    let record
    try {
      record = buildQuoteRecord({
        id,
        poem: item.poem,
        rawText: item.rawText,
        themes: item.themes,
        tags,
        context: item.context,
      })
    } catch (err) {
      log.error('生成失败「{0}」：{1}', item.rawText, err.message)
      continue
    }
    const file = uniqueQuotePath(item.rawText, fileSet)
    fs.writeFileSync(file, record.content, 'utf8')
    generated += 1
    generatedRecords.push({
      id,
      text: item.rawText,
      author: item.poem.author,
      dynasty: item.poem.dynasty,
      themes: item.themes,
      stage: item.poem.curriculum.stage,
      file: path.basename(file),
      poem: item.poem,
      context: item.context,
    })
    log.debug('写入 {0} ← {1}《{2}》', path.basename(file), item.poem.author, item.poem.title)
  }
  genStep.end('新增名句 {0} 条（受总条数上限 {1} 约束，备选未生成 {2} 条）', generated, MAX_TOTAL_QUOTES, skippedByLimit.length)

  // 统计
  const allRecords = [...existingRecords, ...generatedRecords]
  const themeCount = new Map(THEMES.map((t) => [t, 0]))
  const dynastyCount = new Map()
  const stageCount = new Map()
  for (const r of allRecords) {
    for (const t of r.themes) themeCount.set(t, (themeCount.get(t) ?? 0) + 1)
    dynastyCount.set(r.dynasty, (dynastyCount.get(r.dynasty) ?? 0) + 1)
    stageCount.set(r.stage, (stageCount.get(r.stage) ?? 0) + 1)
  }

  const total = allRecords.length
  if (total < 100 || total > 140) {
    log.error('最终名句总数 {0} 不在任务要求的 100-140 区间', total)
  }

  // 语境副索引：供名句浏览页直接读取（不修改 build-index 的六件产物）
  fs.mkdirSync(path.dirname(DETAIL_PATH), { recursive: true })
  fs.writeFileSync(
    DETAIL_PATH,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: allRecords.length,
      items: allRecords.map((r) => ({
        id: r.id,
        context: r.context,
        scene: sceneFor(r.themes),
      })),
    }, null, 2),
    'utf8',
  )

  log.summary('名句库扩充摘要', [
    ['候选清单', `${CANDIDATES.length} 条`],
    ['校验通过', `${valid.length} 条`],
    ['校验丢弃', `${discarded.length} 条`],
    ['重复跳过', `${duplicates.length} 条`],
    ['既有补全', `${existingRecords.length} 条`],
    ['新增生成', `${generated} 条`],
    ['备选未生成', `${skippedByLimit.length} 条`],
    ['最终总数', `${total} 条`],
    ['主题覆盖', `${[...themeCount.values()].filter((n) => n > 0).length}/${THEMES.length} 个`],
    ['语境副索引', 'site/public/indexes/quotes-detail.json'],
    ['报告', 'docs/quotes-report.md'],
  ])

  // 报告
  const themeRows = [...themeCount.entries()]
    .map(([t, n]) => `| ${t} | ${n} | ${total ? ((n / total) * 100).toFixed(1) : '0.0'}% |`)
    .join('\n')
  const dynastyRows = [...dynastyCount.entries()]
    .sort((a, b) => DYNASTY_ORDER.indexOf(a[0]) - DYNASTY_ORDER.indexOf(b[0]) || b[1] - a[1])
    .map(([d, n]) => `| ${d} | ${n} |`)
    .join('\n')
  const stageRows = [...stageCount.entries()]
    .sort((a, b) => ['primary', 'junior', 'senior'].indexOf(a[0]) - ['primary', 'junior', 'senior'].indexOf(b[0]))
    .map(([s, n]) => `| ${STAGE_LABEL[s] ?? s} | ${n} |`)
    .join('\n')
  const discardRows = discarded.length
    ? discarded.map((d, i) => `| ${i + 1} | ${d.text} | ${d.hint} | ${d.reason} |`).join('\n')
    : '| — | 无 | — | — |'
  const duplicateRows = duplicates.length
    ? duplicates.map((d, i) => `| ${i + 1} | ${d.text} | ${d.hint} | ${d.reason} |`).join('\n')
    : '| — | 无 | — | — |'
  const skippedRows = skippedByLimit.length
    ? skippedByLimit.map((d, i) => `| ${i + 1} | ${d.rawText} | ${d.poem.author}《${d.poem.title}》 | 校验通过，受总条数上限 ${MAX_TOTAL_QUOTES} 约束未生成 |`).join('\n')
    : '| — | 无 | — | — |'
  const existingRows = existingRecords.length
    ? existingRecords.map((r, i) => `| ${i + 1} | ${r.text} | ${r.poem.author}《${r.poem.title}》 | ${r.file} |`).join('\n')
    : '| — | 无 | — | — |'
  const noteRows = existingNotes.length ? existingNotes.map((n) => `- ${n}`).join('\n') : '- 无'
  const archiveRows = archived.length
    ? archived.map((a, i) => `| ${i + 1} | ${a.text} | ${a.file} | ${a.reason} |`).join('\n')
    : '| — | 无 | — | — |'

  const report = `# 万卷 · 名句库扩充报告

> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}
> 生成脚本：\`scripts/expand-quotes.mjs\`
> 数据契约：\`docs/data-model.md\` §2.3

## 1. 结果概览

| 指标 | 数值 |
|---|---|
| 候选清单 | ${CANDIDATES.length} 条 |
| 逐字校验通过 | ${valid.length} 条 |
| 逐字校验丢弃 | ${discarded.length} 条 |
| 与已收录重复 | ${duplicates.length} 条 |
| 既有名句补全 | ${existingRecords.length} 条 |
| 新增生成 | ${generated} 条 |
| 备选未生成（受上限约束） | ${skippedByLimit.length} 条 |
| **最终名句总数** | **${total} 条** |

## 2. 主题分布

| 主题 | 条数 | 占比 |
|---|---|---|
${themeRows}

> 一条名句可属 1-3 个主题，故主题计数之和大于总条数。

## 3. 朝代分布

| 朝代 | 条数 |
|---|---|
${dynastyRows}

## 4. 学段分布

| 学段 | 条数 |
|---|---|
${stageRows}

## 5. 丢弃清单（逐字校验未通过）

校验规则：候选名句去掉标点/空白后，必须在本库 \`content/poems/**/*.md\` 的「## 原文」块中逐字命中；命中不到、或与提示作者/篇名不符的，一律丢弃。

| # | 候选名句 | 提示出处 | 丢弃原因 |
|---|---|---|---|
${discardRows}

## 6. 重复跳过

| # | 候选名句 | 提示出处 | 原因 |
|---|---|---|---|
${duplicateRows}

## 7. 备选未生成（校验通过但超出总数上限）

| # | 候选名句 | 出处 | 原因 |
|---|---|---|---|
${skippedRows}

## 8. 既有名句处理

| # | 名句 | 出处 | 文件 |
|---|---|---|---|
${existingRows}

### 说明

${noteRows}

### 归档（未通过校验的既有名句）

| # | 名句 | 文件 | 原因 |
|---|---|---|---|
${archiveRows}

## 9. 验证结果

> 本节在脚本运行后由实际构建与浏览器测试补全。

- 脚本运行：${total >= 100 && total <= 140 ? '通过（总数在 100-140 区间）' : '未通过（总数不在 100-140 区间）'}
- \`npm run build:index\`：待验证
- \`npx vitepress build site\`：待验证
- 浏览器实测：待验证

## 10. 已知局限

- 名句正文严格取自本库 \`content/poems/\` 的「## 原文」块；部分课标篇目在导入时存在节选、异文或 OCR 讹字（如 \`春风自绿江南岸\`、\`沈舟侧畔\`），本脚本一律以库内原文为准，不按通行本改写。
- 语境为「包含名句的整句 + 必要的下一句」，散文长句可能比诗体两句更长。
- 本库未收录的常见名句不会凭记忆生成，统一进入第 5 节丢弃清单。
- 名句浏览器页的拼音搜索在客户端用 \`pinyin-pro\` 计算，不新增构建索引字段。
`

  fs.writeFileSync(REPORT_PATH, report, 'utf8')
  log.ok('报告已写入 docs/quotes-report.md（耗时 {0}ms）', Math.max(1, Date.now() - startedAt))
}

main().catch((err) => {
  log.error('名句扩充异常终止：{0}', err?.stack || err?.message || err)
  process.exit(1)
})
