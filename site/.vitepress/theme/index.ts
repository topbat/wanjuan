import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import KnowledgeGraph from './components/KnowledgeGraph.vue'
import WordCloud from './components/WordCloud.vue'
import TagStats from './components/TagStats.vue'
import AdvancedSearch from './components/AdvancedSearch.vue'
import StageList from './components/StageList.vue'
import WjHome from './components/WjHome.vue'
import ImageryHub from './components/ImageryHub.vue'
import SemanticField from './components/SemanticField.vue'
import CompareReader from './components/CompareReader.vue'
import QuoteCards from './components/QuoteCards.vue'
import IdiomBrowser from './components/IdiomBrowser.vue'
import QuoteBrowser from './components/QuoteBrowser.vue'
import ReviewDeck from './components/ReviewDeck.vue'
import DailyQuiz from './components/DailyQuiz.vue'
import MistakeBook from './components/MistakeBook.vue'
import './themes/editorial.css' // 默认主题（:root 兜底）
import './themes/ink.css'
import './themes/youth.css'
import './custom.css'
import { mountBackToTop } from './backtop'

/**
 * 万卷主题：默认主题 + 三主题令牌（宣纸/编辑/少年）+ 全局可视化组件
 * + 顶栏主题切换 + 「在 VS Code 中打开」回源注入。
 * 组件同步注册（ECharts 等重依赖在各组件 onMounted 内动态 import，仍按需分包）。
 */
export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app, router }) {
    // 返回顶部：纯 DOM 注入（不受插槽 hydrate 时序影响）
    if (typeof window !== 'undefined') {
      const boot = () => setTimeout(mountBackToTop, 0)
      boot()
      router?.onAfterRouteChanged?.(() => setTimeout(mountBackToTop, 0))
    }
    // 全局注册（页面内直接以 <KnowledgeGraph /> 等标签挂载）
    app.component('KnowledgeGraph', KnowledgeGraph)
    app.component('WordCloud', WordCloud)
    app.component('TagStats', TagStats)
    app.component('AdvancedSearch', AdvancedSearch)
    app.component('StageList', StageList)
    app.component('WjHome', WjHome)
    app.component('ImageryHub', ImageryHub)
    app.component('SemanticField', SemanticField)
    app.component('CompareReader', CompareReader)
    app.component('QuoteCards', QuoteCards)
    app.component('IdiomBrowser', IdiomBrowser)
    app.component('QuoteBrowser', QuoteBrowser)
    app.component('ReviewDeck', ReviewDeck) // 学习系统：FSRS 复习（/review/）
    app.component('DailyQuiz', DailyQuiz) // 学习系统：每日一卷（/quiz/）
    app.component('MistakeBook', MistakeBook) // 学习系统：错题本（/quiz/mistakes）
  },
} satisfies Theme
