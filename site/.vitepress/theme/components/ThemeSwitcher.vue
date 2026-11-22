<script setup lang="ts">
// 万卷 · 顶栏主题切换器（三态：宣纸 / 编辑 / 少年）
// 切换即写 html[data-theme] + localStorage('wj-theme')，并广播事件供图表重绘。
import { onMounted, ref } from 'vue'
import { WJ_THEMES, currentTheme, setTheme, type WjThemeName } from '../composables/useWjTheme'

const active = ref<WjThemeName>('editorial')

onMounted(() => {
  active.value = currentTheme()
})

function pick(id: WjThemeName) {
  active.value = id
  setTheme(id)
}
</script>

<template>
  <div class="wj-switcher" role="radiogroup" aria-label="界面主题" :title="`界面主题：${active === 'editorial' ? '编辑' : active === 'ink' ? '宣纸' : '少年'}`">
    <button
      v-for="t in WJ_THEMES"
      :key="t.id"
      type="button"
      role="radio"
      :aria-checked="active === t.id"
      class="wj-switcher-item"
      :class="{ active: active === t.id }"
      @click="pick(t.id)"
    >
      <span class="wj-switcher-dot" :style="{ background: t.dot }"></span>
      <span class="wj-switcher-label">{{ t.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.wj-switcher {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  margin-right: 8px;
}
.wj-switcher-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--wj-ink-2);
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: var(--wj-radius-pill);
  cursor: pointer;
  font-family: var(--wj-font-display);
  transition: all 0.16s;
}
.wj-switcher-item:hover {
  color: var(--wj-ink);
}
.wj-switcher-item.active {
  background: var(--wj-accent);
  color: #fff;
}
.wj-switcher-item.active .wj-switcher-dot {
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.9);
}
.wj-switcher-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
  border: 1px solid rgba(0, 0, 0, 0.12);
}

/* 窄屏：只留色点，避免把汉堡菜单挤出视口 */
@media (max-width: 900px) {
  .wj-switcher { padding: 2px; gap: 0; border: 0; background: transparent; }
  .wj-switcher-item { padding: 4px 3px; }
  .wj-switcher-label { display: none; }
  .wj-switcher-dot { width: 12px; height: 12px; }
}
</style>
