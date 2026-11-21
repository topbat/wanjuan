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

export default defineConfig({
  title: '万卷 · 中小学文学知识库',
  description:
    '读书破万卷，下笔如有神。诗词、成语、名句、作者、意象的本地知识图谱：可点击的关系图、拼音全文检索、课标双轨统计。',
  lang: 'zh-CN',
  lastUpdated: false,

  // 站点源目录 = 仓库根；仅 content/ 与 site/ 下的 md 参与渲染（见 srcExclude）
  srcDir: '..',
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
    'content/:splat*': ':splat*',
  },

  head: [
    // 运行时配置（vscode:// 回源通道的仓库根注入点，见 site/public/runtime-config.js）
    ['script', { src: '/runtime-config.js' }],
  ],

  themeConfig: {
    // 站内搜索（VitePress 内置 minisearch，中文分词可用）
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '全文搜索' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    nav: [
      { text: '首页', link: '/' },
      {
        text: '探索',
        items: [
          { text: '知识图谱', link: '/explore/graph' },
          { text: '主题词云', link: '/explore/wordcloud' },
          { text: '双轨统计', link: '/explore/stats' },
          { text: '高级检索', link: '/explore/search' },
        ],
      },
      { text: '学段', items: stageLinks },
    ],

    sidebar: {
      '/explore/': [
        {
          text: '探索',
          items: [
            { text: '知识图谱', link: '/explore/graph' },
            { text: '主题词云', link: '/explore/wordcloud' },
            { text: '双轨统计', link: '/explore/stats' },
            { text: '高级检索', link: '/explore/search' },
          ],
        },
      ],
      '/stage/': [{ text: '学段', items: stageLinks }],
    },

    // 回源通道一：GitHub 编辑链接
    // （注意：VitePress 1.x 运行时按 `:path` 占位符替换，写作 {path} 不会被替换）
    editLink: {
      pattern: 'https://github.com/topbat/wanjuan/edit/main/:path',
      text: '编辑此页',
    },

    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    externalLinkIcon: true,
  },
})
