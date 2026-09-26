<template>
  <div role="status" :aria-label="label" aria-busy="true" class="space-y-4">
    <span class="sr-only">{{ label }}</span>
    <div aria-hidden="true" class="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-6 animate-pulse motion-reduce:animate-none">
      <div class="h-5 w-1/3 rounded bg-slate-800"></div>
      <div v-for="row in rows" :key="row" class="space-y-3">
        <div class="h-3 w-1/4 rounded bg-slate-800"></div>
        <div class="h-10 rounded-lg bg-slate-800/70"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: '正在加载…' },
  rows: { type: Number, default: 3 }
})
</script>
