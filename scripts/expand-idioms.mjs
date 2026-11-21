#!/usr/bin/env node
/**
 * 万卷 · 成语库扩充脚本
 *
 * 数据源：.vendor/idioms/idiom.json（30,895 条，crazywhalecc/idiom-database，MIT）
 *       释义 / 出处 / 例句一律取自该数据集，不自行编写或编造。
 *
 * 流程：
 *   1. 精选白名单（约 360 条，面向中小学高频、褒义/励志/劝学/品德/智慧/团结/惜时/家国）；
 *   2. 按 word 与数据集精确匹配，查不到即跳过并计入报告；
 *   3. 生成 / 更新 content/idioms/<word>.md，frontmatter 遵循 docs/data-model.md §2.2；
 *   4. 已有词条只补缺字段，保留人工正文与既有元数据，不覆盖。
 *
 * 用法：
 *   node scripts/expand-idioms.mjs            # 生成/更新
 *   node scripts/expand-idioms.mjs --verbose  # 额外输出逐条语义场分类命中词
 *   node scripts/expand-idioms.mjs --dry-run  # 只统计，不写文件
 */
import fs from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'
import matter from 'gray-matter'
import { createLogger } from './lib/logger.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const DATASET = path.join(ROOT, '.vendor/idioms/idiom.json')
const IDIOM_DIR = path.join(ROOT, 'content/idioms')
const POEM_DIR = path.join(ROOT, 'content/poems')

const args = new Set(process.argv.slice(2))
const VERBOSE = args.has('--verbose')
const DRY_RUN = args.has('--dry-run')
const log = createLogger({ verbose: VERBOSE })

// ─────────────────────────── 1. 精选白名单 ───────────────────────────
// 分组仅用于人工维护与报告；semantic_field 由下方关键词规则独立判定。
const WHITELIST_GROUPS = {
  勤奋励志: [
    '锲而不舍', '持之以恒', '坚持不懈', '坚定不移', '坚韧不拔', '百折不挠', '矢志不渝', '始终如一',
    '有始有终', '善始善终', '孜孜不倦', '孜孜以求', '发愤图强', '奋发图强', '励精图治', '自强不息',
    '厚德载物', '任重道远', '壮志凌云', '雄心壮志', '胸怀大志', '志在千里', '老骥伏枥', '壮心不已',
    '磨杵成针', '铁杵成针', '水滴石穿', '绳锯木断', '愚公移山', '精卫填海', '夸父逐日', '卧薪尝胆',
    '闻鸡起舞', '悬梁刺股', '凿壁偷光', '囊萤映雪', '程门立雪', '废寝忘食', '夜以继日', '通宵达旦',
    '只争朝夕', '时不我待', '革故鼎新', '推陈出新', '奋发有为',
  ],
  学习求知: [
    '温故知新', '学而不厌', '学无止境', '学以致用', '学富五车', '博览群书', '博古通今', '博学多才',
    '博闻强识', '满腹经纶', '才华横溢', '才高八斗', '出口成章', '下笔成章', '妙笔生花', '笔走龙蛇',
    '栩栩如生', '惟妙惟肖', '别出心裁', '独具匠心', '匠心独运', '精益求精', '一丝不苟', '全神贯注',
    '聚精会神', '专心致志', '一心一意', '心无旁骛', '目不转睛', '手不释卷', '韦编三绝', '牛角挂书',
    '勤学苦练', '勤能补拙', '笨鸟先飞', '业精于勤', '循序渐进', '举一反三', '融会贯通', '触类旁通',
    '豁然开朗', '恍然大悟', '茅塞顿开', '实事求是', '不耻下问', '敏而好学', '教学相长', '才思敏捷',
  ],
  品德修养: [
    '光明磊落', '谦虚谨慎', '虚怀若谷', '廉洁奉公', '克己奉公', '大公无私', '公而忘私', '舍己为人',
    '助人为乐', '拾金不昧', '见义勇为', '尊师重道', '感恩戴德', '饮水思源', '一诺千金', '言而有信',
    '言行一致', '表里如一', '童叟无欺', '克勤克俭', '艰苦朴素', '省吃俭用', '两袖清风', '刚正不阿',
    '铁面无私', '宽宏大量', '宽以待人', '严于律己', '豁达大度', '彬彬有礼', '温文尔雅', '文质彬彬',
    '落落大方', '不卑不亢', '反躬自省', '三省吾身', '改过自新', '浪子回头', '迷途知返', '见贤思齐',
    '择善而从', '从善如流', '闻过则喜', '高风亮节', '德高望重', '鞠躬尽瘁',
  ],
  智慧谋略: [
    '足智多谋', '神机妙算', '运筹帷幄', '决胜千里', '深谋远虑', '未雨绸缪', '高瞻远瞩', '明察秋毫',
    '洞若观火', '大智若愚', '大巧若拙', '韬光养晦', '知己知彼', '随机应变', '当机立断', '多谋善断',
    '深思熟虑', '三思而行', '谨言慎行', '言简意赅', '要言不烦', '一语中的', '一针见血', '入木三分',
    '力透纸背', '鞭辟入里', '见微知著', '一叶知秋', '炉火纯青', '出神入化', '鬼斧神工', '巧夺天工',
    '别具一格', '独树一帜',
  ],
  勇气毅力: [
    '勇往直前', '一往无前', '奋不顾身', '挺身而出', '临危不惧', '无所畏惧', '披荆斩棘', '排除万难',
    '知难而进', '逆水行舟', '力挽狂澜', '中流砥柱', '坚如磐石', '百炼成钢', '千锤百炼', '破釜沉舟',
    '背水一战', '义无反顾', '敢作敢当', '当仁不让', '大义凛然', '临危受命',
  ],
  团结协作: [
    '同心协力', '众志成城', '齐心协力', '万众一心', '同舟共济', '风雨同舟', '和衷共济', '群策群力',
    '集思广益', '通力合作', '守望相助', '患难与共', '肝胆相照', '志同道合', '情同手足', '亲密无间',
    '休戚与共',
  ],
  惜时进取: [
    '争分夺秒', '分秒必争', '机不可失', '刻不容缓', '日积月累', '日新月异', '蒸蒸日上', '欣欣向荣',
    '朝气蓬勃', '万象更新', '焕然一新',
  ],
  家国情怀: [
    '精忠报国', '匹夫有责', '忧国忧民', '国泰民安', '保家卫国', '赤子之心', '忠心耿耿', '国富民强',
    '繁荣昌盛', '太平盛世', '政通人和', '天下为公', '以身许国', '尽忠报国', '落叶归根', '故土难离',
  ],
  友情交往: [
    '青梅竹马', '两小无猜', '莫逆之交', '忘年之交', '管鲍之交', '高山流水', '一见如故', '相见恨晚',
    '促膝谈心', '推心置腹', '开诚布公', '将心比心', '设身处地', '礼尚往来', '总角之交', '形影不离',
    '朝夕相处', '患难之交',
  ],
  处世哲理: [
    '亡羊补牢', '塞翁失马', '因地制宜', '因材施教', '量力而行', '按部就班', '脚踏实地', '稳扎稳打',
    '恰到好处', '适可而止', '过犹不及', '物极必反', '相辅相成', '相得益彰', '取长补短', '扬长避短',
    '居安思危', '防患未然', '有备无患', '水到渠成', '顺理成章', '理所当然', '名副其实', '名不虚传',
    '实至名归', '一分为二', '统筹兼顾', '顾全大局', '釜底抽薪', '对症下药', '有的放矢', '因势利导',
    '顺水推舟', '水涨船高', '大处着眼',
  ],
  景物描写: [
    '山清水秀', '鸟语花香', '春暖花开', '春意盎然', '万紫千红', '百花齐放', '花团锦簇', '层峦叠嶂',
    '湖光山色', '水天一色', '风和日丽', '秋高气爽', '白雪皑皑', '冰天雪地', '万籁俱寂', '生机勃勃',
    '郁郁葱葱', '姹紫嫣红', '草长莺飞', '莺歌燕舞', '波光粼粼', '烟波浩渺', '崇山峻岭', '一望无际',
    '沃野千里', '江山如画', '山明水秀', '山重水复', '柳暗花明', '春华秋实', '五谷丰登', '月明星稀',
    '清风明月',
  ],
  成功荣誉: [
    '一帆风顺', '马到成功', '旗开得胜', '名列前茅', '出类拔萃', '脱颖而出', '独占鳌头', '金榜题名',
    '鹏程万里', '大有作为', '大有可为', '后生可畏', '青出于蓝', '后来居上', '尽善尽美', '完美无缺',
    '十全十美', '无与伦比', '举世闻名', '闻名遐迩', '名扬四海', '家喻户晓', '有口皆碑', '交口称赞',
    '赞不绝口', '叹为观止', '拍案叫绝', '喜出望外', '欢天喜地', '兴高采烈', '眉开眼笑', '笑逐颜开',
    '心花怒放', '安居乐业', '丰衣足食',
  ],
  // 既有 20 条中的其余 10 条：纳入白名单以补全字段与正文，但生成时保留人工元数据与正文。
  既有词条: [
    '完璧归赵', '名落孙山', '四面楚歌', '守株待兔', '掩耳盗铃', '望梅止渴', '洛阳纸贵',
    '画蛇添足', '纸上谈兵', '胸有成竹', '负荆请罪',
  ],
}

const WHITELIST = Object.values(WHITELIST_GROUPS).flat()

// ─────────────────────────── 2. 语义场规则 ───────────────────────────
// 固定枚举；按「词形命中 3 分 / 释义命中 1 分」计分，取最高分，平手按规则顺序。
const SEMANTIC_FIELDS = [
  '勤奋励志', '品德修养', '诚信正直', '智慧谋略', '勇气毅力', '学习求知',
  '团结协作', '惜时进取', '家国情怀', '友情交往', '处世哲理', '景物描写', '其他',
]

const FIELD_RULES = [
  {
    field: '家国情怀',
    keywords: [
      '报国', '爱国', '忧国', '国泰', '国富', '保家卫国', '匹夫', '赤子', '忠心', '社稷',
      '天下为公', '以身许国', '尽忠', '故土', '落叶归根', '民族', '祖国', '家国',
      '太平盛世', '政通', '人和', '安居', '乐业', '丰衣足食', '国富民强',
    ],
  },
  {
    field: '团结协作',
    keywords: [
      '团结', '同心', '协力', '齐心', '众志', '万众', '同舟', '和衷共济', '群策', '集思',
      '通力', '守望', '患难与共', '休戚与共', '众擎', '合作', '携手', '肝胆', '志同道合',
    ],
  },
  {
    field: '友情交往',
    keywords: [
      '朋友', '友谊', '交情', '知音', '情谊', '交往', '相处', '知己', '手足', '亲密', '之交',
      '相见', '送别', '友情', '情同', '形影不离', '促膝', '推心置腹', '开诚布公', '将心比心',
      '设身处地', '礼尚往来', '总角', '两小无猜', '童年', '一见如故', '谈心', '朝夕',
    ],
  },
  {
    field: '诚信正直',
    keywords: [
      '诚信', '信用', '诚实', '守信', '诺言', '言行', '表里', '正直', '公正', '无私', '廉洁',
      '光明磊落', '刚正', '铁面', '两袖清风', '克己奉公', '公而忘私', '大公无私', '一诺千金',
      '童叟无欺', '开诚', '真诚',
    ],
  },
  {
    field: '品德修养',
    keywords: [
      '品德', '道德', '修养', '谦虚', '虚怀', '宽容', '宽宏', '礼貌', '尊师', '孝敬', '助人',
      '善良', '节俭', '克勤克俭', '艰苦朴素', '省吃俭用', '拾金不昧', '见义勇为', '舍己为人',
      '感恩', '饮水思源', '改过', '三省', '反躬', '择善', '从善', '闻过', '高风亮节', '德高望重',
      '鞠躬', '彬彬有礼', '温文尔雅', '文质彬彬', '落落大方', '不卑不亢', '豁达大度', '严于律己',
      '宽以待人', '尊老', '尊长', '礼让', '廉耻', '忠厚', '仁爱', '仁义',
      '浪子回头', '迷途知返', '见贤思齐', '改邪归正',
    ],
  },
  {
    field: '惜时进取',
    keywords: [
      '光阴', '时间', '分秒', '朝夕', '惜时', '及时', '日积月累', '日新月异', '蒸蒸日上',
      '欣欣向荣', '朝气', '进取', '革新', '更新', '万象', '焕然', '只争', '机不可失',
      '刻不容缓', '蹉跎', '革故', '鼎新', '推陈', '出新', '奋发向上', '向上',
    ],
  },
  {
    field: '学习求知',
    keywords: [
      '学习', '读书', '学问', '知识', '求学', '请教', '温习', '理解', '领会', '博览', '博学',
      '博闻', '才华', '才思', '文思', '写作', '下笔', '满腹经纶', '学富五车', '才高八斗',
      '教诲', '教学相长', '举一反三', '融会贯通', '触类旁通', '豁然开朗', '恍然大悟', '茅塞顿开',
      '释卷', '韦编', '牛角挂书', '勤学', '好学', '不耻下问', '循序渐进', '温故', '知新',
      '精益', '一丝不苟', '专心', '集中', '入神', '手不释卷', '出口成章', '下笔成章', '妙笔',
      '书法', '技艺', '纯熟', '功夫', '逼真', '惟妙惟肖', '栩栩如生', '别出心裁',
    ],
  },
  {
    field: '勤奋励志',
    keywords: [
      '勤奋', '刻苦', '努力', '恒心', '毅力', '坚持', '不懈', '奋斗', '奋发', '图强', '志向',
      '志气', '立志', '自强', '励精', '孜孜', '夜以继日', '日夜', '通宵', '废寝忘食', '悬梁',
      '刺股', '凿壁', '囊萤', '映雪', '程门', '闻鸡', '卧薪', '磨杵', '铁杵', '水滴石穿',
      '绳锯', '愚公', '精卫', '夸父', '壮志', '雄心', '胸怀大志', '老骥', '壮心', '有为',
      '任重', '厚德载物', '发愤', '勤能补拙', '笨鸟先飞', '业精于勤', '勤学苦练', '刻苦耐劳',
      '埋头苦干', '脚踏实地', '兢兢业业', '恪尽职守', '志在千里', '百尺竿头', '更上一层楼',
      '坚定不移', '矢志不渝', '善始善终', '一心一意', '学无止境', '名列前茅', '出类拔萃',
      '脱颖而出', '独占鳌头', '金榜题名', '鹏程万里', '大有作为', '大有可为', '后生可畏',
      '青出于蓝', '后来居上', '马到成功', '旗开得胜', '建功立业', '功成名就',
    ],
  },
  {
    field: '勇气毅力',
    keywords: [
      '勇敢', '勇气', '无畏', '勇往', '奋不顾身', '临危', '挺身', '坚韧', '百折', '斩棘',
      '力挽', '中流', '磐石', '百炼', '千锤', '磨炼', '锻炼', '破釜', '背水', '义无反顾',
      '敢作敢当', '当仁不让', '大义凛然', '排除万难', '知难而进', '逆水行舟', '一往无前',
      '勇挑', '敢为人先', '视死如归', '舍生取义', '临危受命',
    ],
  },
  {
    field: '智慧谋略',
    keywords: [
      '智慧', '聪明', '谋略', '计谋', '策略', '谋划', '见识', '洞察', '预见', '随机应变',
      '当机立断', '深思', '远虑', '神机', '运筹', '足智', '明察', '洞若观火', '大智若愚',
      '大巧若拙', '韬光', '知己知彼', '多谋', '三思', '谨言', '言简意赅', '要言不烦',
      '一语中的', '一针见血', '入木三分', '力透纸背', '鞭辟入里', '见微知著', '一叶知秋',
      '炉火纯青', '出神入化', '鬼斧神工', '巧夺天工', '匠心', '别具一格', '独树一帜',
      '别出心裁', '高瞻远瞩', '深谋远虑', '未雨绸缪', '决胜千里',
    ],
  },
  {
    field: '处世哲理',
    keywords: [
      '道理', '哲理', '规律', '处事', '处世', '分寸', '适度', '辩证', '因果', '得失', '祸福',
      '安危', '防患', '有备', '居安思危', '水到渠成', '顺理成章', '理所当然', '名副其实',
      '名不虚传', '实至名归', '因地制宜', '因材施教', '量力而行', '按部就班', '脚踏实地',
      '稳扎稳打', '恰到好处', '适可而止', '过犹不及', '物极必反', '相辅相成', '相得益彰',
      '取长补短', '扬长避短', '统筹兼顾', '顾全大局', '釜底抽薪', '对症下药', '有的放矢',
      '因势利导', '顺水推舟', '水涨船高', '一分为二', '塞翁失马', '亡羊补牢', '大处着眼',
      '完美', '尽善尽美', '十全十美',
    ],
  },
  {
    field: '景物描写',
    keywords: [
      '景色', '风景', '山水', '风光', '天气', '阳光', '繁星', '波光', '烟波', '五谷', '硕果',
      '山清水秀', '鸟语花香', '春暖花开', '春意盎然', '万紫千红', '百花齐放', '花团锦簇',
      '层峦叠嶂', '湖光山色', '水天一色', '风和日丽', '秋高气爽', '白雪皑皑', '冰天雪地',
      '万籁俱寂', '生机勃勃', '郁郁葱葱', '姹紫嫣红', '草长莺飞', '莺歌燕舞', '波光粼粼',
      '烟波浩渺', '崇山峻岭', '一望无际', '沃野千里', '江山如画', '山明水秀', '山重水复',
      '柳暗花明', '春华秋实', '五谷丰登', '月明星稀', '清风明月', '春日', '春风', '秋水',
      '冬雪', '绿树', '红花', '明月', '青山', '碧水', '蓝天', '白云',
    ],
  },
]

function classifySemanticField(word, explanation) {
  let best = { field: '其他', score: 0, hits: [] }
  for (const rule of FIELD_RULES) {
    let score = 0
    const hits = []
    for (const kw of rule.keywords) {
      if (word.includes(kw)) {
        score += 3
        hits.push(`词:${kw}`)
      } else if (explanation.includes(kw)) {
        score += 1
        hits.push(`释义:${kw}`)
      }
    }
    if (score > best.score) best = { field: rule.field, score, hits }
  }
  return best
}

// ─────────────────────────── 3. 近义 / 反义（可靠常识，宁缺毋滥）───────────────────────────
// 仅收录常用且语义关系明确的词条；未收录者输出空数组，不做推测。
const RELATIONS = {
  锲而不舍: { syn: ['持之以恒', '坚持不懈'], ant: ['半途而废', '浅尝辄止'] },
  持之以恒: { syn: ['锲而不舍', '坚持不懈'], ant: ['半途而废', '一曝十寒'] },
  坚持不懈: { syn: ['持之以恒', '锲而不舍'], ant: ['半途而废', '虎头蛇尾'] },
  坚定不移: { syn: ['矢志不渝', '始终如一'], ant: ['摇摆不定', '朝三暮四'] },
  坚韧不拔: { syn: ['百折不挠', '坚强不屈'], ant: ['一蹶不振', '软弱无能'] },
  百折不挠: { syn: ['坚韧不拔', '不屈不挠'], ant: ['一蹶不振', '知难而退'] },
  矢志不渝: { syn: ['坚定不移', '始终如一'], ant: ['朝三暮四', '见异思迁'] },
  始终如一: { syn: ['一如既往', '善始善终'], ant: ['朝三暮四', '虎头蛇尾'] },
  有始有终: { syn: ['善始善终', '始终如一'], ant: ['有头无尾', '半途而废'] },
  善始善终: { syn: ['有始有终', '始终如一'], ant: ['虎头蛇尾', '半途而废'] },
  孜孜不倦: { syn: ['废寝忘食', '孜孜以求'], ant: ['无所事事', '游手好闲'] },
  发愤图强: { syn: ['奋发图强', '自强不息'], ant: ['自暴自弃', '苟且偷安'] },
  奋发图强: { syn: ['发愤图强', '自强不息'], ant: ['自暴自弃', '苟且偷安'] },
  自强不息: { syn: ['发愤图强', '自力更生'], ant: ['自暴自弃', '自甘堕落'] },
  壮志凌云: { syn: ['雄心壮志', '志在千里'], ant: ['胸无大志', '鼠目寸光'] },
  雄心壮志: { syn: ['壮志凌云', '志在千里'], ant: ['胸无大志', '无所作为'] },
  老骥伏枥: { syn: ['老当益壮', '壮心不已'], ant: ['未老先衰', '暮气沉沉'] },
  磨杵成针: { syn: ['水滴石穿', '持之以恒'], ant: ['半途而废', '浅尝辄止'] },
  水滴石穿: { syn: ['绳锯木断', '锲而不舍'], ant: ['半途而废', '浅尝辄止'] },
  愚公移山: { syn: ['持之以恒', '锲而不舍'], ant: ['半途而废'] },
  精卫填海: { syn: ['愚公移山', '矢志不渝'], ant: ['半途而废'] },
  夸父逐日: { syn: ['精卫填海', '矢志不渝'], ant: ['半途而废'] },
  卧薪尝胆: { syn: ['发愤图强', '励精图治'], ant: ['骄奢淫逸', '苟且偷安'] },
  闻鸡起舞: { syn: ['发愤图强', '废寝忘食'], ant: ['游手好闲', '苟且偷安'] },
  悬梁刺股: { syn: ['凿壁偷光', '废寝忘食'], ant: ['游手好闲'] },
  凿壁偷光: { syn: ['囊萤映雪', '悬梁刺股'], ant: ['不学无术'] },
  囊萤映雪: { syn: ['凿壁偷光', '悬梁刺股'], ant: ['不学无术'] },
  程门立雪: { syn: ['尊师重道', '虚心求教'], ant: ['目无尊长'] },
  废寝忘食: { syn: ['夜以继日', '孜孜不倦'], ant: ['游手好闲', '饱食终日'] },
  夜以继日: { syn: ['废寝忘食', '通宵达旦'], ant: ['游手好闲'] },
  只争朝夕: { syn: ['争分夺秒', '分秒必争'], ant: ['虚度光阴', '蹉跎岁月'] },
  争分夺秒: { syn: ['分秒必争', '只争朝夕'], ant: ['虚度光阴'] },
  分秒必争: { syn: ['争分夺秒', '只争朝夕'], ant: ['虚度光阴'] },
  温故知新: { syn: ['举一反三', '融会贯通'], ant: [] },
  学而不厌: { syn: ['学无止境', '手不释卷'], ant: ['骄傲自满', '不学无术'] },
  学无止境: { syn: ['学而不厌', '精益求精'], ant: ['故步自封', '骄傲自满'] },
  博览群书: { syn: ['学富五车', '博古通今'], ant: ['目不识丁', '孤陋寡闻'] },
  博古通今: { syn: ['博学多才', '学贯中西'], ant: ['目不识丁', '孤陋寡闻'] },
  博学多才: { syn: ['才华横溢', '博古通今'], ant: ['才疏学浅', '目不识丁'] },
  满腹经纶: { syn: ['学富五车', '才高八斗'], ant: ['才疏学浅', '胸无点墨'] },
  才华横溢: { syn: ['才高八斗', '博学多才'], ant: ['才疏学浅'] },
  才高八斗: { syn: ['才华横溢', '学富五车'], ant: ['才疏学浅', '胸无点墨'] },
  出口成章: { syn: ['下笔成章', '妙笔生花'], ant: ['语无伦次', '词不达意'] },
  下笔成章: { syn: ['出口成章', '妙笔生花'], ant: ['词不达意'] },
  栩栩如生: { syn: ['惟妙惟肖', '活灵活现'], ant: ['死气沉沉'] },
  惟妙惟肖: { syn: ['栩栩如生', '活灵活现'], ant: ['画虎类犬'] },
  独具匠心: { syn: ['别出心裁', '匠心独运'], ant: ['千篇一律', '如出一辙'] },
  匠心独运: { syn: ['独具匠心', '别出心裁'], ant: ['千篇一律'] },
  精益求精: { syn: ['锦上添花', '精雕细琢'], ant: ['敷衍了事', '得过且过'] },
  一丝不苟: { syn: ['精益求精', '郑重其事'], ant: ['粗心大意', '敷衍了事'] },
  全神贯注: { syn: ['聚精会神', '专心致志'], ant: ['心不在焉', '三心二意'] },
  聚精会神: { syn: ['全神贯注', '专心致志'], ant: ['心不在焉', '魂不守舍'] },
  专心致志: { syn: ['全神贯注', '一心一意'], ant: ['心不在焉', '三心二意'] },
  一心一意: { syn: ['专心致志', '全心全意'], ant: ['三心二意', '心猿意马'] },
  手不释卷: { syn: ['博览群书', '学而不厌'], ant: ['不学无术', '游手好闲'] },
  韦编三绝: { syn: ['手不释卷', '勤学苦练'], ant: ['不学无术'] },
  勤能补拙: { syn: ['笨鸟先飞', '勤学苦练'], ant: ['自暴自弃'] },
  笨鸟先飞: { syn: ['勤能补拙', '勤学苦练'], ant: ['自暴自弃', '坐以待毙'] },
  循序渐进: { syn: ['按部就班', '由浅入深'], ant: ['拔苗助长', '急于求成'] },
  举一反三: { syn: ['触类旁通', '融会贯通'], ant: ['一窍不通', '生搬硬套'] },
  融会贯通: { syn: ['举一反三', '触类旁通'], ant: ['一知半解', '生吞活剥'] },
  触类旁通: { syn: ['举一反三', '融会贯通'], ant: ['一窍不通'] },
  豁然开朗: { syn: ['恍然大悟', '茅塞顿开'], ant: ['百思不解', '大惑不解'] },
  恍然大悟: { syn: ['豁然开朗', '茅塞顿开'], ant: ['百思不解', '大惑不解'] },
  茅塞顿开: { syn: ['恍然大悟', '豁然开朗'], ant: ['百思不解', '冥顽不灵'] },
  光明磊落: { syn: ['正大光明', '襟怀坦白'], ant: ['鬼鬼祟祟', '居心叵测'] },
  谦虚谨慎: { syn: ['虚怀若谷', '不骄不躁'], ant: ['骄傲自满', '目中无人'] },
  虚怀若谷: { syn: ['谦虚谨慎', '不耻下问'], ant: ['骄傲自满', '目空一切'] },
  廉洁奉公: { syn: ['克己奉公', '两袖清风'], ant: ['贪赃枉法', '假公济私'] },
  克己奉公: { syn: ['廉洁奉公', '大公无私'], ant: ['假公济私', '损公肥私'] },
  大公无私: { syn: ['克己奉公', '公而忘私'], ant: ['假公济私', '自私自利'] },
  公而忘私: { syn: ['大公无私', '舍己为人'], ant: ['假公济私', '自私自利'] },
  舍己为人: { syn: ['舍己救人', '助人为乐'], ant: ['自私自利', '损人利己'] },
  助人为乐: { syn: ['舍己为人', '乐善好施'], ant: ['损人利己', '自私自利'] },
  拾金不昧: { syn: ['路不拾遗', '廉洁奉公'], ant: ['见利忘义', '贪得无厌'] },
  见义勇为: { syn: ['挺身而出', '仗义执言'], ant: ['袖手旁观', '见死不救'] },
  尊师重道: { syn: ['程门立雪', '尊师重教'], ant: ['目无尊长'] },
  一诺千金: { syn: ['言而有信', '一言九鼎'], ant: ['言而无信', '出尔反尔'] },
  言而有信: { syn: ['一诺千金', '言行一致'], ant: ['言而无信', '出尔反尔'] },
  言行一致: { syn: ['表里如一', '言而有信'], ant: ['言行不一', '口是心非'] },
  表里如一: { syn: ['言行一致', '心口如一'], ant: ['口是心非', '表里不一'] },
  克勤克俭: { syn: ['勤俭节约', '艰苦朴素'], ant: ['铺张浪费', '挥霍无度'] },
  艰苦朴素: { syn: ['克勤克俭', '勤俭节约'], ant: ['铺张浪费', '骄奢淫逸'] },
  两袖清风: { syn: ['廉洁奉公', '克己奉公'], ant: ['贪赃枉法', '中饱私囊'] },
  刚正不阿: { syn: ['铁面无私', '光明磊落'], ant: ['阿谀奉承', '趋炎附势'] },
  铁面无私: { syn: ['刚正不阿', '大公无私'], ant: ['徇私舞弊', '徇情枉法'] },
  宽宏大量: { syn: ['豁达大度', '宽以待人'], ant: ['斤斤计较', '小肚鸡肠'] },
  严于律己: { syn: ['宽以待人', '克己奉公'], ant: ['放任自流'] },
  彬彬有礼: { syn: ['温文尔雅', '文质彬彬'], ant: ['蛮横无理', '粗野无礼'] },
  温文尔雅: { syn: ['彬彬有礼', '文质彬彬'], ant: ['粗野无礼'] },
  文质彬彬: { syn: ['温文尔雅', '彬彬有礼'], ant: ['粗野无礼'] },
  落落大方: { syn: ['不卑不亢', '彬彬有礼'], ant: ['扭扭捏捏', '局促不安'] },
  不卑不亢: { syn: ['落落大方', '不骄不躁'], ant: ['卑躬屈膝', '妄自尊大'] },
  见贤思齐: { syn: ['择善而从', '从善如流'], ant: ['嫉贤妒能', '自暴自弃'] },
  从善如流: { syn: ['闻过则喜', '择善而从'], ant: ['刚愎自用', '讳疾忌医'] },
  德高望重: { syn: ['众望所归', '年高德劭'], ant: ['声名狼藉', '德薄能鲜'] },
  足智多谋: { syn: ['神机妙算', '多谋善断'], ant: ['一筹莫展', '无计可施'] },
  神机妙算: { syn: ['足智多谋', '运筹帷幄'], ant: ['一筹莫展', '束手无策'] },
  运筹帷幄: { syn: ['神机妙算', '深谋远虑'], ant: ['一筹莫展', '束手无策'] },
  深谋远虑: { syn: ['高瞻远瞩', '未雨绸缪'], ant: ['鼠目寸光', '目光短浅'] },
  未雨绸缪: { syn: ['防患未然', '有备无患'], ant: ['临渴掘井', '江心补漏'] },
  高瞻远瞩: { syn: ['深谋远虑', '目光远大'], ant: ['鼠目寸光', '目光如豆'] },
  明察秋毫: { syn: ['洞若观火', '见微知著'], ant: ['视而不见', '熟视无睹'] },
  洞若观火: { syn: ['明察秋毫', '一清二楚'], ant: ['雾里看花', '一无所知'] },
  大智若愚: { syn: ['大巧若拙', '深藏不露'], ant: ['锋芒毕露', '自作聪明'] },
  韬光养晦: { syn: ['深藏不露', '大智若愚'], ant: ['锋芒毕露', '恃才傲物'] },
  知己知彼: { syn: ['了如指掌', '心中有数'], ant: ['一无所知'] },
  随机应变: { syn: ['当机立断', '见机行事'], ant: ['墨守成规', '一成不变'] },
  当机立断: { syn: ['随机应变', '毫不犹豫'], ant: ['优柔寡断', '犹豫不决'] },
  深思熟虑: { syn: ['三思而行', '谨言慎行'], ant: ['草率从事', '轻举妄动'] },
  三思而行: { syn: ['深思熟虑', '谨言慎行'], ant: ['轻举妄动', '鲁莽从事'] },
  谨言慎行: { syn: ['三思而行', '深思熟虑'], ant: ['信口开河', '轻举妄动'] },
  言简意赅: { syn: ['要言不烦', '一语中的'], ant: ['长篇大论', '拖泥带水'] },
  一针见血: { syn: ['一语中的', '入木三分'], ant: ['隔靴搔痒', '不着边际'] },
  入木三分: { syn: ['力透纸背', '鞭辟入里'], ant: ['浮光掠影', '浅尝辄止'] },
  见微知著: { syn: ['一叶知秋', '明察秋毫'], ant: ['视而不见'] },
  炉火纯青: { syn: ['登峰造极', '出神入化'], ant: ['初出茅庐', '半生不熟'] },
  出神入化: { syn: ['炉火纯青', '鬼斧神工'], ant: ['平淡无奇'] },
  鬼斧神工: { syn: ['巧夺天工', '出神入化'], ant: ['粗制滥造'] },
  巧夺天工: { syn: ['鬼斧神工', '精雕细琢'], ant: ['粗制滥造'] },
  独树一帜: { syn: ['别具一格', '独具匠心'], ant: ['千篇一律', '人云亦云'] },
  勇往直前: { syn: ['一往无前', '奋勇向前'], ant: ['畏缩不前', '裹足不前'] },
  一往无前: { syn: ['勇往直前', '所向披靡'], ant: ['畏缩不前'] },
  奋不顾身: { syn: ['挺身而出', '舍生忘死'], ant: ['贪生怕死', '畏首畏尾'] },
  挺身而出: { syn: ['见义勇为', '奋不顾身'], ant: ['袖手旁观', '畏缩不前'] },
  临危不惧: { syn: ['无所畏惧', '视死如归'], ant: ['惊慌失措', '贪生怕死'] },
  无所畏惧: { syn: ['临危不惧', '勇往直前'], ant: ['畏首畏尾', '胆小如鼠'] },
  披荆斩棘: { syn: ['排除万难', '乘风破浪'], ant: ['畏缩不前', '知难而退'] },
  排除万难: { syn: ['披荆斩棘', '知难而进'], ant: ['知难而退', '畏缩不前'] },
  力挽狂澜: { syn: ['中流砥柱', '扭转乾坤'], ant: ['回天乏术', '束手无策'] },
  中流砥柱: { syn: ['力挽狂澜', '栋梁之材'], ant: [] },
  坚如磐石: { syn: ['稳如泰山', '牢不可破'], ant: ['摇摇欲坠', '一触即溃'] },
  百炼成钢: { syn: ['千锤百炼', '坚韧不拔'], ant: ['娇生惯养'] },
  千锤百炼: { syn: ['百炼成钢', '精益求精'], ant: ['粗制滥造'] },
  破釜沉舟: { syn: ['背水一战', '义无反顾'], ant: ['优柔寡断', '瞻前顾后'] },
  背水一战: { syn: ['破釜沉舟', '决一死战'], ant: ['临阵脱逃', '望风而逃'] },
  义无反顾: { syn: ['勇往直前', '破釜沉舟'], ant: ['优柔寡断', '畏首畏尾'] },
  同心协力: { syn: ['齐心协力', '众志成城'], ant: ['各行其是', '离心离德'] },
  众志成城: { syn: ['万众一心', '齐心协力'], ant: ['一盘散沙', '离心离德'] },
  齐心协力: { syn: ['同心协力', '万众一心'], ant: ['各行其是', '一盘散沙'] },
  万众一心: { syn: ['众志成城', '齐心协力'], ant: ['一盘散沙', '离心离德'] },
  同舟共济: { syn: ['风雨同舟', '和衷共济'], ant: ['各自为政', '离心离德'] },
  风雨同舟: { syn: ['同舟共济', '患难与共'], ant: ['同床异梦'] },
  和衷共济: { syn: ['同舟共济', '齐心协力'], ant: ['离心离德', '各行其是'] },
  群策群力: { syn: ['集思广益', '齐心协力'], ant: ['独断专行', '各行其是'] },
  集思广益: { syn: ['群策群力', '博采众长'], ant: ['独断专行', '一意孤行'] },
  通力合作: { syn: ['齐心协力', '同心协力'], ant: ['各自为政'] },
  守望相助: { syn: ['同舟共济', '患难与共'], ant: ['隔岸观火', '袖手旁观'] },
  患难与共: { syn: ['同舟共济', '风雨同舟'], ant: ['同床异梦', '离心离德'] },
  肝胆相照: { syn: ['推心置腹', '披肝沥胆'], ant: ['勾心斗角', '尔虞我诈'] },
  志同道合: { syn: ['情投意合', '同心同德'], ant: ['分道扬镳', '格格不入'] },
  情同手足: { syn: ['亲如兄弟', '亲密无间'], ant: ['势不两立', '反目成仇'] },
  亲密无间: { syn: ['情同手足', '形影不离'], ant: ['势不两立', '貌合神离'] },
  休戚与共: { syn: ['同舟共济', '患难与共'], ant: ['无关痛痒', '隔岸观火'] },
  日积月累: { syn: ['积少成多', '循序渐进'], ant: ['一曝十寒', '坐吃山空'] },
  日新月异: { syn: ['一日千里', '突飞猛进'], ant: ['一成不变', '故步自封'] },
  蒸蒸日上: { syn: ['欣欣向荣', '方兴未艾'], ant: ['江河日下', '每况愈下'] },
  欣欣向荣: { syn: ['蒸蒸日上', '朝气蓬勃'], ant: ['死气沉沉', '江河日下'] },
  朝气蓬勃: { syn: ['生机勃勃', '欣欣向荣'], ant: ['暮气沉沉', '老气横秋'] },
  万象更新: { syn: ['焕然一新', '面目一新'], ant: ['一成不变', '依然如故'] },
  焕然一新: { syn: ['面目一新', '万象更新'], ant: ['一成不变', '依然如故'] },
  精忠报国: { syn: ['尽忠报国', '为国捐躯'], ant: ['卖国求荣', '里通外国'] },
  匹夫有责: { syn: ['责无旁贷', '义不容辞'], ant: ['袖手旁观', '漠不关心'] },
  忧国忧民: { syn: ['忧国忘家', '心系天下'], ant: ['漠不关心', '自私自利'] },
  国泰民安: { syn: ['国富民强', '太平盛世'], ant: ['民不聊生', '国破家亡'] },
  保家卫国: { syn: ['精忠报国', '守土有责'], ant: ['卖国求荣'] },
  赤子之心: { syn: ['赤胆忠心', '忠心耿耿'], ant: ['狼子野心'] },
  忠心耿耿: { syn: ['赤胆忠心', '忠贞不渝'], ant: ['三心二意', '背信弃义'] },
  国富民强: { syn: ['国泰民安', '繁荣昌盛'], ant: ['民穷财尽', '国困民穷'] },
  繁荣昌盛: { syn: ['兴旺发达', '欣欣向荣'], ant: ['江河日下', '日薄西山'] },
  太平盛世: { syn: ['国泰民安', '海晏河清'], ant: ['兵荒马乱', '民不聊生'] },
  政通人和: { syn: ['国泰民安', '安居乐业'], ant: ['民怨沸腾'] },
  天下为公: { syn: ['大公无私', '公而忘私'], ant: ['自私自利'] },
  以身许国: { syn: ['精忠报国', '舍身为国'], ant: ['卖国求荣'] },
  两小无猜: { syn: ['青梅竹马', '两小无嫌'], ant: [] },
  莫逆之交: { syn: ['管鲍之交', '情同手足'], ant: ['泛泛之交'] },
  忘年之交: { syn: ['莫逆之交', '忘年之契'], ant: ['泛泛之交'] },
  管鲍之交: { syn: ['莫逆之交', '生死之交'], ant: ['泛泛之交', '酒肉朋友'] },
  高山流水: { syn: ['知音难觅'], ant: [] },
  一见如故: { syn: ['相见恨晚', '亲密无间'], ant: ['形同陌路'] },
  相见恨晚: { syn: ['一见如故', '相知恨晚'], ant: ['形同陌路'] },
  推心置腹: { syn: ['开诚布公', '肝胆相照'], ant: ['勾心斗角', '尔虞我诈'] },
  开诚布公: { syn: ['推心置腹', '以诚相待'], ant: ['勾心斗角', '尔虞我诈'] },
  将心比心: { syn: ['设身处地', '推己及人'], ant: ['自私自利'] },
  设身处地: { syn: ['将心比心', '推己及人'], ant: ['漠不关心'] },
  礼尚往来: { syn: ['投桃报李'], ant: [] },
  形影不离: { syn: ['亲密无间', '如影随形'], ant: ['形同陌路'] },
  朝夕相处: { syn: ['形影不离', '耳鬓厮磨'], ant: ['天各一方'] },
  患难之交: { syn: ['莫逆之交', '生死之交'], ant: ['酒肉朋友'] },
  塞翁失马: { syn: ['因祸得福', '否极泰来'], ant: ['乐极生悲'] },
  因地制宜: { syn: ['因势利导', '实事求是'], ant: ['生搬硬套', '刻舟求剑'] },
  量力而行: { syn: ['实事求是', '尽力而为'], ant: ['不自量力', '好高骛远'] },
  按部就班: { syn: ['循序渐进', '有条不紊'], ant: ['急于求成', '一步登天'] },
  脚踏实地: { syn: ['实事求是', '稳扎稳打'], ant: ['好高骛远', '纸上谈兵'] },
  稳扎稳打: { syn: ['脚踏实地', '步步为营'], ant: ['急于求成', '轻举妄动'] },
  恰到好处: { syn: ['恰如其分', '适可而止'], ant: ['过犹不及', '画蛇添足'] },
  适可而止: { syn: ['恰到好处', '知足常乐'], ant: ['得寸进尺', '贪得无厌'] },
  过犹不及: { syn: ['物极必反', '适可而止'], ant: ['恰到好处'] },
  物极必反: { syn: ['过犹不及', '否极泰来'], ant: ['恰到好处'] },
  相辅相成: { syn: ['相得益彰', '珠联璧合'], ant: ['水火不容'] },
  相得益彰: { syn: ['相辅相成', '珠联璧合'], ant: ['两败俱伤', '相形见绌'] },
  取长补短: { syn: ['扬长避短', '博采众长'], ant: ['故步自封'] },
  扬长避短: { syn: ['取长补短', '避实就虚'], ant: [] },
  居安思危: { syn: ['防患未然', '有备无患'], ant: ['高枕无忧', '麻痹大意'] },
  防患未然: { syn: ['未雨绸缪', '有备无患'], ant: ['临渴掘井', '临阵磨枪'] },
  有备无患: { syn: ['未雨绸缪', '防患未然'], ant: ['临渴掘井', '措手不及'] },
  水到渠成: { syn: ['顺理成章', '瓜熟蒂落'], ant: ['拔苗助长', '急于求成'] },
  顺理成章: { syn: ['水到渠成', '理所当然'], ant: ['牵强附会'] },
  理所当然: { syn: ['天经地义', '顺理成章'], ant: [] },
  名副其实: { syn: ['名不虚传', '实至名归'], ant: ['名不副实', '徒有虚名'] },
  名不虚传: { syn: ['名副其实', '货真价实'], ant: ['名不副实', '徒有虚名'] },
  实至名归: { syn: ['名副其实', '名不虚传'], ant: ['徒有虚名', '名不副实'] },
  统筹兼顾: { syn: ['顾全大局', '面面俱到'], ant: ['顾此失彼'] },
  顾全大局: { syn: ['统筹兼顾', '大局为重'], ant: ['各自为政', '因小失大'] },
  釜底抽薪: { syn: ['拔本塞源'], ant: ['扬汤止沸', '火上浇油'] },
  对症下药: { syn: ['有的放矢', '因材施教'], ant: ['无的放矢', '隔靴搔痒'] },
  有的放矢: { syn: ['对症下药'], ant: ['无的放矢'] },
  因势利导: { syn: ['因地制宜', '顺水推舟'], ant: [] },
  顺水推舟: { syn: ['因势利导', '借风使船'], ant: ['逆水行舟'] },
  水涨船高: { syn: ['水长船高', '相辅相成'], ant: [] },
  山清水秀: { syn: ['山明水秀', '风景如画'], ant: ['穷山恶水'] },
  鸟语花香: { syn: ['春暖花开', '鸟语莺啼'], ant: ['冰天雪地'] },
  春暖花开: { syn: ['春意盎然', '鸟语花香'], ant: ['天寒地冻'] },
  春意盎然: { syn: ['春暖花开', '生机勃勃'], ant: [] },
  万紫千红: { syn: ['百花齐放', '姹紫嫣红'], ant: ['百花凋零'] },
  百花齐放: { syn: ['万紫千红', '姹紫嫣红'], ant: ['一花独放'] },
  花团锦簇: { syn: ['万紫千红', '姹紫嫣红'], ant: [] },
  层峦叠嶂: { syn: ['崇山峻岭', '千山万壑'], ant: ['一马平川'] },
  湖光山色: { syn: ['山清水秀', '风景如画'], ant: [] },
  水天一色: { syn: ['水天相接', '一望无际'], ant: [] },
  风和日丽: { syn: ['阳光明媚', '春暖花开'], ant: ['风雨交加', '天寒地冻'] },
  秋高气爽: { syn: ['天高云淡', '风和日丽'], ant: [] },
  白雪皑皑: { syn: ['冰天雪地', '银装素裹'], ant: ['绿树成荫'] },
  冰天雪地: { syn: ['白雪皑皑', '天寒地冻'], ant: ['春暖花开'] },
  万籁俱寂: { syn: ['鸦雀无声', '夜深人静'], ant: ['人声鼎沸', '锣鼓喧天'] },
  生机勃勃: { syn: ['朝气蓬勃', '欣欣向荣'], ant: ['死气沉沉'] },
  郁郁葱葱: { syn: ['枝繁叶茂', '苍翠欲滴'], ant: ['枯枝败叶'] },
  姹紫嫣红: { syn: ['万紫千红', '花团锦簇'], ant: ['百花凋零'] },
  草长莺飞: { syn: ['春暖花开', '鸟语花香'], ant: [] },
  莺歌燕舞: { syn: ['鸟语花香', '歌舞升平'], ant: [] },
  波光粼粼: { syn: ['水光潋滟', '碧波荡漾'], ant: [] },
  烟波浩渺: { syn: ['烟波浩淼', '一望无际'], ant: [] },
  崇山峻岭: { syn: ['层峦叠嶂', '高山峻岭'], ant: ['一马平川'] },
  一望无际: { syn: ['无边无际', '辽阔无垠'], ant: ['咫尺之间'] },
  沃野千里: { syn: ['一望无际', '良田万顷'], ant: ['不毛之地'] },
  江山如画: { syn: ['风景如画', '山清水秀'], ant: [] },
  山明水秀: { syn: ['山清水秀', '风景如画'], ant: ['穷山恶水'] },
  山重水复: { syn: ['层峦叠嶂', '峰回路转'], ant: ['一马平川'] },
  柳暗花明: { syn: ['峰回路转', '绝处逢生'], ant: ['山穷水尽', '走投无路'] },
  春华秋实: { syn: ['硕果累累', '五谷丰登'], ant: [] },
  五谷丰登: { syn: ['硕果累累', '国泰民安'], ant: ['颗粒无收'] },
  月明星稀: { syn: ['月白风清'], ant: [] },
  清风明月: { syn: ['月白风清'], ant: [] },
  名列前茅: { syn: ['出类拔萃', '独占鳌头'], ant: ['名落孙山'] },
  出类拔萃: { syn: ['鹤立鸡群', '脱颖而出'], ant: ['碌碌无为', '平庸无奇'] },
  脱颖而出: { syn: ['出类拔萃', '崭露头角'], ant: ['默默无闻'] },
  独占鳌头: { syn: ['名列前茅', '出类拔萃'], ant: ['名落孙山'] },
  金榜题名: { syn: ['蟾宫折桂', '独占鳌头'], ant: ['名落孙山'] },
  鹏程万里: { syn: ['前程万里', '前途无量'], ant: ['穷途末路'] },
  大有作为: { syn: ['大有可为', '前途无量'], ant: ['无所作为'] },
  后生可畏: { syn: ['青出于蓝', '后来居上'], ant: [] },
  青出于蓝: { syn: ['后来居上', '后生可畏'], ant: [] },
  后来居上: { syn: ['青出于蓝'], ant: ['望尘莫及'] },
  尽善尽美: { syn: ['十全十美', '完美无缺'], ant: ['一无是处', '美中不足'] },
  完美无缺: { syn: ['尽善尽美', '十全十美'], ant: ['一无是处', '漏洞百出'] },
  十全十美: { syn: ['尽善尽美', '完美无缺'], ant: ['一无是处', '美中不足'] },
  无与伦比: { syn: ['举世无双', '独一无二'], ant: ['不相上下', '平淡无奇'] },
  举世闻名: { syn: ['闻名遐迩', '名扬四海'], ant: ['默默无闻', '鲜为人知'] },
  闻名遐迩: { syn: ['举世闻名', '名扬四海'], ant: ['默默无闻'] },
  名扬四海: { syn: ['举世闻名', '闻名遐迩'], ant: ['默默无闻'] },
  家喻户晓: { syn: ['妇孺皆知', '人人皆知'], ant: ['默默无闻', '鲜为人知'] },
  有口皆碑: { syn: ['交口称赞', '赞不绝口'], ant: ['怨声载道'] },
  交口称赞: { syn: ['赞不绝口', '有口皆碑'], ant: ['怨声载道'] },
  赞不绝口: { syn: ['交口称赞', '拍案叫绝'], ant: ['嗤之以鼻', '不屑一顾'] },
  叹为观止: { syn: ['拍案叫绝', '赞不绝口'], ant: ['平淡无奇', '不屑一顾'] },
  拍案叫绝: { syn: ['赞不绝口', '叹为观止'], ant: ['嗤之以鼻'] },
  喜出望外: { syn: ['喜从天降', '大喜过望'], ant: ['大失所望', '悲痛欲绝'] },
  欢天喜地: { syn: ['兴高采烈', '喜气洋洋'], ant: ['愁眉苦脸', '闷闷不乐'] },
  兴高采烈: { syn: ['欢天喜地', '喜气洋洋'], ant: ['垂头丧气', '无精打采'] },
  眉开眼笑: { syn: ['笑逐颜开', '喜笑颜开'], ant: ['愁眉苦脸', '愁眉不展'] },
  笑逐颜开: { syn: ['眉开眼笑', '喜笑颜开'], ant: ['愁眉苦脸'] },
  心花怒放: { syn: ['欢天喜地', '欣喜若狂'], ant: ['愁肠百结', '悲痛欲绝'] },
  安居乐业: { syn: ['国泰民安', '丰衣足食'], ant: ['颠沛流离', '民不聊生'] },
  丰衣足食: { syn: ['安居乐业', '国富民强'], ant: ['饥寒交迫', '缺衣少食'] },
}

// ─────────────────────────── 4. 学段（保守）───────────────────────────
// 小学语文教材/课外阅读高频词 → primary；其余一律 junior；不臆测具体年级，统一取学段末年级。
const PRIMARY_WORDS = new Set([
  '亡羊补牢', '守株待兔', '掩耳盗铃', '画蛇添足', '望梅止渴', '精卫填海', '愚公移山', '夸父逐日',
  '完璧归赵', '负荆请罪', '胸有成竹', '青梅竹马', '水滴石穿', '锲而不舍', '专心致志', '聚精会神',
  '全神贯注', '一丝不苟', '废寝忘食', '温故知新', '学而不厌', '博览群书', '勤学苦练', '笨鸟先飞',
  '勤能补拙', '手不释卷', '程门立雪', '凿壁偷光', '囊萤映雪', '悬梁刺股', '闻鸡起舞', '三思而行',
  '一心一意', '目不转睛', '恍然大悟', '豁然开朗', '茅塞顿开', '栩栩如生', '惟妙惟肖', '出口成章',
  '下笔成章', '妙笔生花', '才思敏捷', '出类拔萃', '名列前茅', '春暖花开', '鸟语花香', '山清水秀',
  '万紫千红', '百花齐放', '花团锦簇', '秋高气爽', '冰天雪地', '生机勃勃', '郁郁葱葱', '草长莺飞',
  '莺歌燕舞', '一望无际', '江山如画', '山明水秀', '柳暗花明', '五谷丰登', '月明星稀', '清风明月',
  '风和日丽', '湖光山色', '水天一色', '白雪皑皑', '万籁俱寂', '姹紫嫣红', '波光粼粼', '崇山峻岭',
  '沃野千里', '春华秋实', '同心协力', '众志成城', '齐心协力', '万众一心', '同舟共济', '风雨同舟',
  '守望相助', '助人为乐', '拾金不昧', '见义勇为', '尊师重道', '一诺千金', '言而有信', '言行一致',
  '表里如一', '彬彬有礼', '精忠报国', '匹夫有责', '国泰民安', '保家卫国', '赤子之心', '天下为公',
  '一帆风顺', '马到成功', '旗开得胜', '金榜题名', '鹏程万里', '十全十美', '举世闻名', '家喻户晓',
  '赞不绝口', '喜出望外', '欢天喜地', '兴高采烈', '眉开眼笑', '笑逐颜开', '心花怒放', '安居乐业',
  '丰衣足食', '脚踏实地', '实事求是', '取长补短', '有备无患', '理所当然', '名副其实', '名不虚传',
  '日积月累', '日新月异', '蒸蒸日上', '欣欣向荣', '朝气蓬勃', '万象更新', '焕然一新', '争分夺秒',
  '分秒必争', '刻不容缓',
])

function curriculumFor(word) {
  return PRIMARY_WORDS.has(word)
    ? { stage: 'primary', grade: 6, recitation: false }
    : { stage: 'junior', grade: 7, recitation: false }
}

// ─────────────────────────── 5. 工具函数 ───────────────────────────
const CJK_SAFE = /^[\p{Script=Han}\p{Letter}\p{Number} .·_-]+$/u

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null'
  const s = String(value)
  if (s === '') return '""'
  return CJK_SAFE.test(s) && !s.includes(':') && !s.startsWith('-') ? s : JSON.stringify(s)
}

function yamlString(value) {
  if (value === null || value === undefined) return 'null'
  return JSON.stringify(String(value))
}

function yamlArray(arr) {
  return `[${(arr ?? []).map(yamlScalar).join(', ')}]`
}

function yamlCurriculum(c) {
  return `{ stage: ${c.stage}, grade: ${c.grade}, recitation: ${c.recitation} }`
}

function truncate(text, max) {
  const chars = [...String(text ?? '')]
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('')
}

function isMissing(text) {
  const s = String(text ?? '').trim()
  return s === '' || s === '无'
}

function detectSourceTags(derivation) {
  const tags = []
  if (/(史记|汉书|后汉书|三国志|晋书|宋史|北史|南史|旧唐书|新唐书|战国策|左传|国语|资治通鉴|明史|清史稿)/.test(derivation)) {
    tags.push('出自史书')
  }
  if (/(论语|孟子|荀子|老子|庄子|韩非子|墨子|列子|管子|淮南子)/.test(derivation)) {
    tags.push('出自诸子')
  }
  if (/(诗经|楚辞|全唐诗|唐诗|宋词|文选|乐府|古诗)/.test(derivation)) {
    tags.push('出自诗文')
  }
  if (/(山海经|神话|传说)/.test(derivation)) {
    tags.push('出自神话')
  }
  return tags
}

function buildPoemIndex() {
  const files = fg.sync('content/poems/**/*.md', { cwd: ROOT, absolute: true })
  const byTitle = new Map()
  const poems = []
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const { data, content } = matter(raw)
      const title = String(data.title ?? '').trim()
      if (!title) continue
      const norm = normalizeTitle(title)
      const entry = { id: data.id, title, norm, content, file }
      poems.push(entry)
      if (!byTitle.has(norm)) byTitle.set(norm, entry)
    } catch (err) {
      log.warn('读取作品失败，跳过：{0}（{1}）', path.relative(ROOT, file), err.message)
    }
  }
  return { byTitle, poems }
}

function normalizeTitle(title) {
  return String(title)
    .replace(/[《》〈〉「」『』（）()·—\-\s，,。.、：:；;！!？?]/g, '')
    .replace(/(十二章|三则|二则|一则|节选)$/g, '')
}

function extractTitles(derivation) {
  const out = []
  for (const m of String(derivation).matchAll(/《([^》]{1,30})》/g)) {
    out.push(m[1])
  }
  return out
}

function findOriginLink(derivation, word, poemIndex) {
  for (const title of extractTitles(derivation)) {
    const norm = normalizeTitle(title)
    if (poemIndex.byTitle.has(norm)) return poemIndex.byTitle.get(norm).id
  }
  // 出处书名与篇名可能因版本/异体字无法完全对齐：退而求其次，找正文实际含该成语的作品。
  const hit = poemIndex.poems.find((p) => p.content.includes(word))
  return hit ? hit.id : null
}

// ─────────────────────────── 6. 生成 / 合并 ───────────────────────────
function buildFields(word, entry, poemIndex, existing) {
  const meaning = String(entry.explanation ?? '').trim()
  const derivationFull = String(entry.derivation ?? '').trim()
  const example = String(entry.example ?? '').trim()
  const hasOrigin = !isMissing(derivationFull)
  const hasExample = !isMissing(example)

  const semantic = classifySemanticField(word, meaning)
  const rel = RELATIONS[word] ?? { syn: [], ant: [] }
  const sourceTags = hasOrigin ? detectSourceTags(derivationFull) : []
  const tags = ['作文素材', ...sourceTags]
  // 既有词条若有人工出处，正文优先展示人工版本（不覆盖、不混用数据集异文）。
  const humanOrigin = String(existing?.origin ?? '').trim()
  const bodyOrigin = humanOrigin || (hasOrigin ? derivationFull : '')

  const generated = {
    id: `idiom-${String(entry.pinyin_r ?? '').replace(/\s+/g, '').toLowerCase()}`,
    word,
    pinyin: String(entry.pinyin ?? '').trim(),
    pinyin_plain: String(entry.pinyin_r ?? '').trim(),
    first: String(entry.first ?? '').trim(),
    last: String(entry.last ?? '').trim(),
    meaning,
    origin: hasOrigin ? truncate(derivationFull, 120) : '',
    origin_link: hasOrigin ? findOriginLink(derivationFull, word, poemIndex) : null,
    semantic_field: semantic.field,
    synonyms: rel.syn,
    antonyms: rel.ant,
    curriculum: curriculumFor(word),
    tags,
  }

  const merged = { ...generated }
  if (existing) {
    for (const key of Object.keys(merged)) {
      const old = existing[key]
      if (old === undefined || old === null) continue
      if (Array.isArray(old)) {
        if (old.length) merged[key] = old
      } else if (typeof old === 'string') {
        if (old.trim() !== '') merged[key] = old
      } else if (typeof old === 'object') {
        if (Object.keys(old).length) merged[key] = old
      } else {
        merged[key] = old
      }
    }
  }

  return {
    fields: merged,
    semantic,
    hasOrigin: Boolean(bodyOrigin),
    hasExample,
    example,
    bodyOrigin,
    derivationFull,
    generatedField: generated.semantic_field,
  }
}

function renderFrontmatter(f) {
  return [
    '---',
    `id: ${yamlScalar(f.id)}`,
    `word: ${yamlScalar(f.word)}`,
    `pinyin: ${yamlScalar(f.pinyin)}`,
    `pinyin_plain: ${yamlScalar(f.pinyin_plain)}`,
    `first: ${yamlScalar(f.first)}`,
    `last: ${yamlScalar(f.last)}`,
    `meaning: ${yamlString(f.meaning)}`,
    `origin: ${yamlString(f.origin ?? '')}`,
    `origin_link: ${f.origin_link ? yamlScalar(f.origin_link) : 'null'}`,
    `semantic_field: ${yamlScalar(f.semantic_field ?? '其他')}`,
    `synonyms: ${yamlArray(f.synonyms)}`,
    `antonyms: ${yamlArray(f.antonyms)}`,
    `curriculum: ${yamlCurriculum(f.curriculum)}`,
    `tags: ${yamlArray(f.tags)}`,
    '---',
  ].join('\n')
}

function renderSections(word, data) {
  const meaning = data.fields.meaning || '（数据集未提供释义）'
  const origin = data.hasOrigin ? data.bodyOrigin : '（数据集未收录出处）'
  const example = data.hasExample
    ? `> 数据集例句：${data.example}`
    : '（数据集未提供例句）'
  const syn = data.fields.synonyms?.length ? data.fields.synonyms.join('、') : '—'
  const ant = data.fields.antonyms?.length ? data.fields.antonyms.join('、') : '—'
  return [
    `# ${word}`,
    '',
    '## 释义',
    '',
    meaning,
    '',
    '## 出处',
    '',
    origin,
    '',
    '## 例句',
    '',
    example,
    '',
    '## 近义 / 反义',
    '',
    `近义：${syn}`,
    '',
    `反义：${ant}`,
    '',
  ].join('\n')
}

function mergeBody(existingBody, word, data) {
  const body = String(existingBody ?? '').trim()
  if (!body) return '\n' + renderSections(word, data)
  const sections = ['## 释义', '## 出处', '## 例句', '## 近义 / 反义']
  const hasH1 = /^#\s+/m.test(body)
  const present = sections.filter((s) => body.includes(s))
  if (!hasH1) {
    return `\n# ${word}\n\n${body}\n`
  }
  if (present.length === sections.length) return '\n' + body + '\n'
  // 人工正文优先：仅在末尾补齐缺失章节，不改动已有段落。
  const full = renderSections(word, data)
  const missingBlocks = []
  for (let i = 0; i < sections.length; i++) {
    if (present.includes(sections[i])) continue
    const start = full.indexOf(sections[i])
    const next = i + 1 < sections.length ? full.indexOf(sections[i + 1]) : full.length
    if (start !== -1) missingBlocks.push(full.slice(start, next).trim())
  }
  return '\n' + body + '\n\n' + missingBlocks.join('\n\n') + '\n'
}

// ─────────────────────────── 7. 主流程 ───────────────────────────
async function main() {
  if (!fs.existsSync(DATASET)) {
    log.error('数据集不存在：{0}', DATASET)
    log.error('请先放置 .vendor/idioms/idiom.json（crazywhalecc/idiom-database）后再运行。')
    return
  }

  const t0 = log.step('读取成语数据集')
  let dataset
  try {
    dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'))
  } catch (err) {
    log.error('数据集解析失败：{0}', err.message)
    return
  }
  if (!Array.isArray(dataset)) {
    log.error('数据集格式异常：顶层应为数组。')
    return
  }
  const byWord = new Map(dataset.map((x) => [x.word, x]))
  t0.end('载入 {0} 条成语', dataset.length)

  const tPoem = log.step('建立作品反查索引')
  const poemIndex = buildPoemIndex()
  tPoem.end('作品 {0} 篇（用于 origin_link 溯源）', poemIndex.poems.length)

  fs.mkdirSync(IDIOM_DIR, { recursive: true })

  const skipped = []
  const skippedNoFile = []
  const fallbackWords = []
  const missingFields = { origin: 0, example: 0, relations: 0, originLink: 0 }
  const fieldCount = new Map(SEMANTIC_FIELDS.map((f) => [f, 0]))
  const ruleHitCount = new Map()
  let created = 0
  let updated = 0
  let unchanged = 0
  let existingFallback = 0

  const t1 = log.step('生成 / 更新成语词条')
  for (const word of WHITELIST) {
    const file = path.join(IDIOM_DIR, `${word}.md`)
    const exists = fs.existsSync(file)
    let existing = null
    let existingBody = ''
    if (exists) {
      try {
        const raw = fs.readFileSync(file, 'utf8')
        const parsed = matter(raw)
        existing = parsed.data
        existingBody = parsed.content
      } catch (err) {
        log.error('已有词条解析失败，保持原样：{0}（{1}）', path.relative(ROOT, file), err.message)
        continue
      }
    }

    let entry = byWord.get(word)
    if (!entry && existing) {
      // 数据集未收录，但库中已有该词条：以人工 frontmatter 为源补全正文与缺字段，绝不覆盖人工值。
      existingFallback += 1
      skipped.push(word)
      fallbackWords.push(word)
      log.warn('数据集未收录「{0}」，沿用既有词条补全正文（保留人工字段）。', word)
      entry = {
        explanation: existing.meaning,
        derivation: existing.origin,
        example: '',
        pinyin: existing.pinyin,
        pinyin_r: existing.pinyin_plain,
        first: existing.first,
        last: existing.last,
      }
    } else if (!entry) {
      skipped.push(word)
      skippedNoFile.push(word)
      log.warn('白名单词条在数据集中不存在且无既有词条，跳过：{0}', word)
      continue
    }

    const data = buildFields(word, entry, poemIndex, existing)
    const frontmatter = renderFrontmatter(data.fields)
    const body = mergeBody(existingBody, word, data)
    const output = `${frontmatter}\n${body}`

    if (data.semantic.field === '其他') {
      log.debug('分类 {0} → 其他（规则未命中）', word)
    } else {
      log.debug('分类 {0} → {1}（{2}）', word, data.semantic.field, data.semantic.hits.join('、'))
      for (const hit of data.semantic.hits) {
        const kw = hit.replace(/^[^:]+:/, '')
        ruleHitCount.set(data.semantic.field, (ruleHitCount.get(data.semantic.field) ?? 0) + 1)
        ruleHitCount.set(`${data.semantic.field}|${kw}`, (ruleHitCount.get(`${data.semantic.field}|${kw}`) ?? 0) + 1)
      }
    }
    fieldCount.set(data.fields.semantic_field, (fieldCount.get(data.fields.semantic_field) ?? 0) + 1)

    if (!data.hasOrigin) missingFields.origin += 1
    if (!data.hasExample) missingFields.example += 1
    if (!data.fields.synonyms?.length && !data.fields.antonyms?.length) missingFields.relations += 1
    if (!data.fields.origin_link) missingFields.originLink += 1

    if (DRY_RUN) {
      unchanged += 1
      continue
    }

    if (!exists) {
      fs.writeFileSync(file, output, 'utf8')
      created += 1
    } else if (output !== fs.readFileSync(file, 'utf8')) {
      fs.writeFileSync(file, output, 'utf8')
      updated += 1
    } else {
      unchanged += 1
    }
  }
  t1.end('新增 {0} 条 · 更新 {1} 条 · 未变 {2} 条', created, updated, unchanged)

  const datasetHits = WHITELIST.length - skipped.length
  const processed = datasetHits + existingFallback
  log.summary('成语库扩充摘要', [
    ['白名单', `${WHITELIST.length} 条`],
    ['数据集命中', `${datasetHits} 条`],
    ['数据集未收录', `${skipped.length} 条${skipped.length ? `（${skipped.join('、')}）` : ''}`],
    ['既有词条补全', `${existingFallback} 条${existingFallback ? `（${fallbackWords.join('、')}，按人工 frontmatter，不覆盖）` : ''}`],
    ['最终跳过', `${skippedNoFile.length} 条${skippedNoFile.length ? `（${skippedNoFile.join('、')}）` : ''}`],
    ['本次新增文件', `${created} 个`],
    ['本次更新文件', `${updated} 个`],
    ['本次未变文件', `${unchanged} 个`],
    ['出处缺失', `${missingFields.origin} 条`],
    ['例句缺失', `${missingFields.example} 条`],
    ['近反义均为空', `${missingFields.relations} 条`],
    ['未溯源到作品', `${missingFields.originLink} 条`],
  ])

  log.summary('语义场分布（含已有词条保留值）', [...fieldCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => [f, `${n} 条`]))

  if (VERBOSE) {
    const topHits = [...ruleHitCount.entries()]
      .filter(([k]) => k.includes('|'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, n]) => {
        const [field, kw] = k.split('|')
        return [`${field} · ${kw}`, `${n} 次`]
      })
    log.summary('高频命中关键词（前 15）', topHits)
  }

  if (DRY_RUN) log.info('干跑模式：未写入任何文件。')
  log.ok(
    '完成：白名单 {0} 条 · 数据集命中 {1} 条 · 既有补全 {2} 条 · 最终跳过 {3} 条 · 本次处理 {4} 条。',
    WHITELIST.length, datasetHits, existingFallback, skippedNoFile.length, processed,
  )
}

main().catch((err) => {
  log.error('脚本异常退出：{0}', err?.stack ?? String(err))
})
