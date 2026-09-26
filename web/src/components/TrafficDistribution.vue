<template>
  <section class="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6" :aria-label="title">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold text-white">{{ title }}</h3>
        <p class="mt-1 text-xs text-slate-400">{{ subtitle }}</p>
      </div>
      <span class="rounded-lg border border-slate-700/70 bg-slate-800/60 px-2 py-1 text-[11px] tabular-nums text-slate-300">{{ rows.length }} {{ unit }}</span>
    </div>

    <div class="relative mx-auto my-6 h-40 w-40">
      <svg viewBox="0 0 160 160" class="h-full w-full -rotate-90" role="img" :aria-label="`${title}：${formatBytes(total)}`">
        <circle cx="80" cy="80" r="64" fill="none" stroke="#1e293b" stroke-width="14" />
        <circle
          v-for="row in rows.filter(row => row.total > 0)"
          :key="row.id"
          cx="80" cy="80" r="64" fill="none" :stroke="row.color" stroke-width="14"
          pathLength="100" :stroke-dasharray="`${row.share} ${100 - row.share}`" :stroke-dashoffset="-row.offset"
        >
          <title>{{ row.name }}：{{ formatBytes(row.total) }} · {{ percentage(row.share) }}</title>
        </circle>
      </svg>
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span class="text-[11px] text-slate-400">累计流量</span>
        <span class="mt-1 text-xl font-semibold tracking-tight text-white tabular-nums">{{ formatBytes(total) }}</span>
      </div>
    </div>

    <p v-if="total === 0" class="mb-4 text-center text-xs text-slate-500">暂无流量，连接代理后自动更新</p>
    <div class="space-y-4">
      <div v-for="row in rows" :key="row.id">
        <div class="flex items-center justify-between gap-2 text-xs">
          <div class="flex min-w-0 items-center gap-2">
            <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: row.color }"></span>
            <span class="truncate font-medium text-slate-200" :title="row.name">{{ row.name }}</span>
          </div>
          <span class="shrink-0 tabular-nums text-slate-300">{{ formatBytes(row.total) }} <span class="ml-1 text-slate-500">{{ percentage(row.share) }}</span></span>
        </div>
        <div class="my-2 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
          <div class="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" :style="{ width: `${row.share}%`, backgroundColor: row.color }"></div>
        </div>
        <div class="flex justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
          <span>↑ 上传 {{ formatBytes(row.uplink) }}</span>
          <span>↓ 下载 {{ formatBytes(row.downlink) }}</span>
        </div>
      </div>
    </div>
    <p v-if="items.some(item => item.id === 'unclassified')" class="mt-5 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">历史未分类为尚未记录归属的流量；新流量会按实际统计归类。</p>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { formatBytes } from '../api'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, required: true },
  unit: { type: String, required: true },
  items: { type: Array, default: () => [] },
})
const colors = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#fb7185', '#2dd4bf']
const total = computed(() => props.items.reduce((sum, item) => sum + item.uplink + item.downlink, 0))
const rows = computed(() => {
  let offset = 0
  return props.items.map((item, index) => ({
    ...item,
    total: item.uplink + item.downlink,
    color: item.id === 'unclassified' ? '#64748b' : colors[index % colors.length],
  })).sort((a, b) => b.total - a.total).map(item => {
    const share = total.value > 0 ? item.total / total.value * 100 : 0
    const row = { ...item, share, offset }
    offset += share
    return row
  })
})
const percentage = value => value > 0 && value < 0.1 ? '<0.1%' : `${Number(value.toFixed(1))}%`
</script>
