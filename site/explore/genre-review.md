---
title: 题材校对台
description: 自动题材标注逐条校对——查看判定依据、确认或改判、localStorage 暂存，并导出可回写 frontmatter 的 Markdown。
---

<script setup>
// 集成者会把 GenreReview 注册为全局组件；此处本地导入保证页面在未注册时也能独立工作。
import GenreReview from '../.vitepress/theme/components/GenreReview.vue'
</script>

# 题材校对台

规则标注解决了「待归类」的批量初判，但机器判断必须可复核。本页把 `genre_source: auto` 的条目按置信度摊开：
**medium 优先展示，high 默认折叠**。每条都能看到标题、作者、当前题材与判定依据（标题命中 + 正文特征词）。

校对动作只写入浏览器 `localStorage`（键 `wj-genre-corrections`），不会直接改仓库文件；
顶部「导出校对结果」会生成 Markdown（含 `id / genre / genre_source: manual` 的 frontmatter 片段与文件路径），
便于按 `srcPath` 批量回写。人工标注（`genre_source: manual`）与仍未判定的「待归类」不在本页重复校对。

<GenreReview />
