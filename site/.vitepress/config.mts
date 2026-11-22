import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

/**
 * 万卷 · VitePress 站点配置
 *
 * 路由策略：srcDir 指向仓库根，content/ 下的词条 Markdown 通过 rewrites
 * 映射为干净的站点路由，例：
 *   content/poems/tang/李白/静夜思.md → /poems/tang/李白/静夜思.html
 * 页面底部「编辑此页」由 editLink 提供（回源通道一：GitHub）；
 * 「在 VS Code 中打开」由 theme 布局注入（回源通道二：vscode:// 协议）。
 */

const stageLinks = [
  { text: '小学', link: '/stage/primary' },
  { text: '初中', link: '/stage/junior' },
  { text: '高中', link: '/stage/senior' },
]

const BASE = process.env.WJ_BASE ?? '/'

export default defineConfig({
  title: '万卷 · 中小学文学知识库',
  description:
    '读书破万卷，下笔如有神。诗词、成语、名句、作者、意象的本地知识图谱：可点击的关系图、拼音全文检索、课标双轨统计。',
  lang: 'zh-CN',
  lastUpdated: false,
  // 三主题（宣纸/编辑/少年）本期均工作于亮色；暗色适配 TODO
  // 亮/暗切换交给 VitePress（html.dark），暗色令牌见 themes/dark.css
  appearance: true,

  // 站点源目录 = 仓库根；仅 content/ 与 site/ 下的 md 参与渲染（见 srcExclude）
  srcDir: '..',
  // 部署路径：GitHub Pages 项目页在 https://<user>.github.io/wanjuan/，CI 通过 WJ_BASE=/wanjuan/ 注入；
  // 本地默认 '/'，保证 dev/preview 正常
  base: BASE,
  // 诗词原文逐句换行依赖 markdown 的 breaks 选项（否则会被折叠成一段）
  // 诗词原文依赖单换行保留分行：经 markdown-it 配置钩子开启 breaks
  markdown: {
    lineNumbers: false,
    config: (md) => md.set({ breaks: true }),
  },
  // 公共资源目录（索引 JSON 由 scripts/build-index.mjs 写入 site/public/indexes/）
  publicDir: 'site/public',
  // 说明：VitePress 1.6.x 的构建期 public 复制固定取 <srcDir>/public（即仓库根 public/），
  // 上面的 publicDir 选项对其不生效；故此处再经 vite 透传显式指定（dev 与 build 均生效）。
  vite: {
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  },
  srcExclude: [
    'README.md',
    'docs/**',
    'design-proposals/**',
    'public/**',
    'scripts/**',
    'node_modules/**',
    '**/node_modules/**',
    'site/public/**',
    'site/.vitepress/**',
  ],

  // 路由重写：content/** → 站点根路径；site 自身页面去除 site/ 前缀
  rewrites: {
    'site/index.md': 'index.md',
    'site/explore/:splat*': 'explore/:splat*',
    'site/stage/:splat*': 'stage/:splat*',
    'site/review/:splat*': 'review/:splat*',
    'site/idioms/:splat*': 'idioms/:splat*',
    'site/quotes/:splat*': 'quotes/:splat*',
    'site/quiz/:splat*': 'quiz/:splat*',
    'content/:splat*': ':splat*',
  },

  head: [
    // 运行时配置（vscode:// 回源通道的仓库根注入点，见 site/public/runtime-config.js）
    // 注意：head 标签不会自动加 base 前缀，这里显式拼接
    ['script', { src: `${BASE}runtime-config.js` }],
    // 主题防闪烁：渲染前同步读 localStorage 并设置 html[data-theme]（默认 editorial）
    [
      'script',
      {},
      "(function(){try{var t=localStorage.getItem('wj-theme');if(['editorial','ink','youth'].indexOf(t)<0)t='editorial';document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','editorial')}})()",
    ],
  ],

  themeConfig: {
    // 站内搜索（VitePress 内置 minisearch，中文分词可用）
    // 搜索统一由自建 GlobalSearch 提供（支持拼音/首字母，Ctrl+K 唤起），
    // 关闭 VitePress 内置搜索以避免两套入口行为不一致
    search: undefined,

    nav: [
      { text: '首页', link: '/' },
      {
        text: '探索',
        items: [
          { text: '知识图谱', link: '/explore/graph' },
          { text: '主题词云', link: '/explore/wordcloud' },
          { text: '双轨统计', link: '/explore/stats' },
          { text: '高级检索', link: '/explore/search' },
          { text: '意象枢纽', link: '/explore/imagery' },
          { text: '成语语义场', link: '/explore/semantic' },
          { text: '对比阅读', link: '/explore/compare' },
          { text: '名句卡片', link: '/explore/quotes-cards' },
          { text: '题材校对', link: '/explore/genre-review' },
        ],
      },
      { text: '成语库', link: '/idioms/' },
      { text: '名句库', link: '/quotes/' },
      {
        text: '学习',
        items: [
          { text: '今日复习', link: '/review/' },
          { text: '每日一卷', link: '/quiz/' },
          { text: '错题本', link: '/quiz/mistakes' },
        ],
      },
      { text: '学段', items: stageLinks },
    ],

    sidebar: {
      '/explore/': [
        {
          text: '数据视图',
          items: [
            { text: '知识图谱', link: '/explore/graph' },
            { text: '主题词云', link: '/explore/wordcloud' },
            { text: '双轨统计', link: '/explore/stats' },
            { text: '高级检索', link: '/explore/search' },
          ],
        },
        {
          text: '知识枢纽',
          items: [
            { text: '意象枢纽', link: '/explore/imagery' },
            { text: '成语语义场', link: '/explore/semantic' },
            { text: '对比阅读', link: '/explore/compare' },
            { text: '名句卡片', link: '/explore/quotes-cards' },
            { text: '题材校对', link: '/explore/genre-review' },
          ],
        },
      ],
      '/review/': [
        { text: '学习', items: [{ text: '今日复习', link: '/review/' }, { text: '每日一卷', link: '/quiz/' }, { text: '错题本', link: '/quiz/mistakes' }] },
      ],
      '/quiz/': [
        { text: '学习', items: [{ text: '今日复习', link: '/review/' }, { text: '每日一卷', link: '/quiz/' }, { text: '错题本', link: '/quiz/mistakes' }] },
      ],
      '/idioms/': [{ text: '成语库', items: [{ text: '成语浏览', link: '/idioms/' }] }],
      '/quotes/': [{ text: '名句库', items: [{ text: '名句浏览', link: '/quotes/' }] }],
      '/stage/': [{ text: '学段', items: stageLinks }],
    },

    // 回源通道一：GitHub 编辑链接
    // （注意：VitePress 1.x 运行时按 `:path` 占位符替换，写作 {path} 不会被替换）
    editLink: {
      pattern: 'https://github.com/topbat/wanjuan/edit/main/:path',
      text: '编辑此页',
    },

    outline: { label: '本页目录', level: [2, 3] },
    // 内容页没有线性顺序，默认「上一篇/下一篇」会跳到不相关页面，统一关闭
    docFooter: false,
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    externalLinkIcon: true,
  },
})
