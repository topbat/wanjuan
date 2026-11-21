<script setup lang="ts">
// 万卷 · 回源通道二：「在 VS Code 中打开」
//
// 路由 → 源文件映射与 config.mts 的 rewrite 规则保持一致：
//   /poems/tang/李白/静夜思 → content/poems/tang/李白/静夜思.md
//
// TODO（运行时仓库根注入，不阻塞当前阶段）：
//   1. 编辑 site/public/runtime-config.js，把 window.__WANJUAN_REPO_ROOT__ 填为本机仓库绝对路径；
//      （该文件不入构建产物逻辑，发布站点时无需配置）
//   2. 或在浏览器控制台执行：localStorage.setItem('wanjuan:repo-root', 'D:/ing-space/wanjuan')
//   3. 后续可由 scripts/build-index.mjs 在写出索引时把 process.cwd() 写入 runtime-config.js 实现自动注入。
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vitepress'

const route = useRoute()
const repoRoot = ref('')

onMounted(() => {
  const injected = String((window as any).__WANJUAN_REPO_ROOT__ ?? '').trim()
  const stored = String(localStorage.getItem('wanjuan:repo-root') ?? '').trim()
  repoRoot.value = stored || injected
})

/** 当前路由对应的 content/ 源文件相对路径（非词条页返回 null） */
const srcPath = computed<string | null>(() => {
  const p = decodeURIComponent(route.path)
    .replace(/(^|\/)index\.html?$/, '/')
    .replace(/\.html?$/, '')
  const m = p.match(/^\/(poems|idioms|quotes|authors|imagery)\/(.+)$/)
  return m ? `content/${m[1]}/${m[2]}.md` : null
})

const href = computed<string | null>(() => {
  if (!srcPath.value || !repoRoot.value) return null
  const root = repoRoot.value.replace(/\\/g, '/').replace(/\/+$/, '')
  return 'vscode://file/' + encodeURI(`${root}/${srcPath.value}`)
})
</script>

<template>
  <div v-if="srcPath" class="wj-open-vscode">
    <a v-if="href" :href="href" title="通过 vscode:// 协议打开本机源文件">在 VS Code 中打开此源文件</a>
    <span v-else class="wj-hint">
      在 VS Code 中打开：<em>未配置仓库根路径</em>（编辑 <code>site/public/runtime-config.js</code>
      或执行 <code>localStorage.setItem('wanjuan:repo-root','D:/ing-space/wanjuan')</code> 启用）
    </span>
    <span class="wj-src">{{ srcPath }}</span>
  </div>
</template>

<style scoped>
.wj-open-vscode {
  margin-top: 24px;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.wj-hint em {
  font-style: normal;
  color: var(--vp-c-text-3);
}
.wj-src {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
