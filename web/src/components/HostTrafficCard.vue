<template>
  <div class="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 flex flex-col justify-between space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>各主机负载分布 (Hosts Load)</span>
        </h3>
        <p class="mt-0.5 text-xs text-slate-400">按物理吞吐排序 · 30秒更新</p>
      </div>
      <span class="rounded-lg border border-slate-700/70 bg-slate-800/60 px-2.5 py-1 text-[11px] font-mono text-slate-300">
        {{ rows.length }} 台接入 · {{ formatBytes(total) }}
      </span>
    </div>

    <p v-if="total === 0" class="py-8 text-center text-xs text-slate-500">
      暂无主机物理流量，连接代理后自动更新
    </p>

    <!-- High Density Ranked Traffic Bars -->
    <div v-else class="space-y-2.5">
      <div
        v-for="(row, idx) in rows"
        :key="row.id"
        class="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/60 hover:border-slate-700/70 transition space-y-1.5"
      >
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-[11px] font-mono text-slate-500 w-3.5">#{{ idx + 1 }}</span>
            <span class="h-2 w-2 rounded-full shrink-0" :style="{ backgroundColor: row.color }"></span>
            <span class="font-medium text-slate-200 truncate" :title="row.name">{{ row.name }}</span>
          </div>
          <div class="flex items-center gap-2 font-mono text-xs tabular-nums shrink-0">
            <span class="text-slate-200 font-semibold">{{ formatBytes(row.total) }}</span>
            <span class="text-slate-500 text-[10px]">({{ percentage(row.share) }})</span>
          </div>
        </div>
        <div class="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden" aria-hidden="true">
          <div
            class="h-full rounded-full transition-all duration-500"
            :style="{ width: `${row.share}%`, backgroundColor: row.color }"
          ></div>
        </div>
        <div class="flex justify-between text-[10px] text-slate-400 font-mono tabular-nums">
          <span>↑ 上传 {{ formatBytes(row.uplink) }}</span>
          <span>↓ 下载 {{ formatBytes(row.downlink) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatBytes } from '../api'

const props = defineProps({
  hosts: { type: Array, default: () => [] }
})

const colors = ['#34d399', '#38bdf8', '#a78bfa', '#fbbf24', '#fb7185', '#2dd4bf']

const total = computed(() => props.hosts.reduce((sum, item) => sum + (item.uplink || 0) + (item.downlink || 0), 0))

const rows = computed(() => {
  let offset = 0
  return props.hosts.map((item, index) => ({
    ...item,
    total: (item.uplink || 0) + (item.downlink || 0),
    color: colors[index % colors.length]
  })).sort((a, b) => b.total - a.total).map(item => {
    const share = total.value > 0 ? (item.total / total.value) * 100 : 0
    const row = { ...item, share, offset }
    offset += share
    return row
  })
})

const percentage = value => value > 0 && value < 0.1 ? '<0.1%' : `${Number(value.toFixed(1))}%`
</script>
