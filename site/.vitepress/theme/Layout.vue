<script setup lang="ts">
// 万卷布局：包裹默认主题，在文档页底部注入「在 VS Code 中打开」回源入口（通道二）。
import DefaultTheme from 'vitepress/theme'
import OpenInVSCode from './components/OpenInVSCode.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #doc-after>
      <OpenInVSCode />
    </template>
  </Layout>
</template>
