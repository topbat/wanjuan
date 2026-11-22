<script setup lang="ts">
// 万卷布局：包裹默认主题。
// - nav-bar-content-after：顶栏主题切换器（宣纸/编辑/少年）
// - doc-after：词条元数据面板 + 「在 VS Code 中打开」回源入口
import DefaultTheme from 'vitepress/theme'
import ThemeSwitcher from './components/ThemeSwitcher.vue'
import EntryMeta from './components/EntryMeta.vue'
import OpenInVSCode from './components/OpenInVSCode.vue'
import Breadcrumb from './components/Breadcrumb.vue'
import GlobalSearch from './components/GlobalSearch.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-before>
      <GlobalSearch />
    </template>
    <template #nav-bar-content-after>
      <ThemeSwitcher />
    </template>
    <template #doc-before>
      <Breadcrumb />
    </template>
    <template #doc-after>
      <EntryMeta />
      <OpenInVSCode />
    </template>
  </Layout>
</template>
