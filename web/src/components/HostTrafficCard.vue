<template>
  <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 flex flex-col justify-between">
    <!-- Header -->
    <div>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-white flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>各主机负载分布 (Hosts Load)</span>
          </h3>
          <p class="mt-1 text-xs text-slate-400">各物理 VPS 节点累计物理吞吐与负载占比</p>
        </div>
        <span class="rounded-lg border border-slate-700/70 bg-slate-800/60 px-2.5 py-1 text-[11px] tabular-nums text-slate-300">
          {{ rows.length }} 台接入
        </span>
      </div>

      <!-- Donut Chart with Top Host Insight -->
      <div class="relative mx-auto my-6 h-44 w-44">
        <svg viewBox="0 0 160 160" class="h-full w-full -rotate-90" role="img" aria-label="主机流量占比">
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
        <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-2">
          <span class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">主力负载主机</span>
          <span class="mt-0.5 text-base font-bold text-white truncate max-w-[130px]" :title="topHost?.name || '暂无'">
            {{ topHost ? topHost.name : '—' }}
          </span>
          <span class="text-xs font-mono font-semibold text-emerald-400 mt-0.5">
            {{ topHost ? percentage(topHost.share) : '0%' }} 负载占比
          </span>
        </div>
      </div>

      <p v-if="total === 0" class="mb-4 text-center text-xs text-slate-500">暂无主机物理流量，连接代理后自动更新</p>

      <!-- Host breakdown rows -->
      <div class="space-y-3.5">
        <div v-for="row in rows" :key="row.id" class="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/60">
          <div class="flex items-center justify-between gap-2 text-xs">
            <div class="flex min-w-0 items-center gap-2">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: row.color }"></span>
              <span class="truncate font-semibold text-slate-200" :title="row.name">{{ row.name }}</span>
            </div>
            <span class="shrink-0 tabular-nums font-mono text-slate-300 font-medium">
              {{ formatBytes(row.total) }}
              <span class="ml-1 text-slate-400 font-sans text-[11px]">({{ percentage(row.share) }})</span>
            </span>
          </div>
          <div class="my-2 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
            <div
              class="h-full rounded-full transition-all duration-500"
              :style="{ width: `${row.share}%`, backgroundColor: row.color }"
            ></div>
          </div>
          <div class="flex justify-between gap-2 text-[11px] text-slate-400 tabular-nums font-mono">
            <span>↑ 上传 {{ formatBytes(row.uplink) }}</span>
            <span>↓ 下载 {{ formatBytes(row.downlink) }}</span>
          </div>
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

const topHost = computed(() => rows.value.length > 0 && rows.value[0].total > 0 ? rows.value[0] : null)

const percentage = value => value > 0 && value < 0.1 ? '<0.1%' : `${Number(value.toFixed(1))}%`
</script>
