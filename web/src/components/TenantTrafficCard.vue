<template>
  <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6 flex flex-col justify-between space-y-6">
    <!-- Header -->
    <div>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-white flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-violet-400"></span>
            <span>各租户流量使用 (Tenant Quota)</span>
          </h3>
          <p class="mt-1 text-xs text-slate-400">租户配额管控与实际使用明细</p>
        </div>
        <span class="rounded-lg border border-slate-700/70 bg-slate-800/60 px-2.5 py-1 text-[11px] tabular-nums text-slate-300">
          {{ users.length }} 位租户
        </span>
      </div>

      <!-- Tenant Quota Cards -->
      <div class="mt-6 space-y-3.5">
        <div
          v-for="user in userRows"
          :key="user.id"
          class="p-4 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-3"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300 text-xs font-bold uppercase shrink-0">
                {{ user.name.slice(0, 2) }}
              </div>
              <span class="font-semibold text-sm text-white truncate">{{ user.name }}</span>
            </div>
            <div class="text-right">
              <span class="text-xs font-mono font-medium text-slate-200 tabular-nums">{{ formatBytes(user.total) }}</span>
              <span class="text-slate-500 text-xs mx-1">/</span>
              <span class="text-xs text-slate-400">{{ user.traffic_limit_bytes > 0 ? formatBytes(user.traffic_limit_bytes) : '不限流量' }}</span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="user.isLimit ? (user.usagePercent > 90 ? 'bg-rose-500' : user.usagePercent > 70 ? 'bg-amber-500' : 'bg-violet-500') : 'bg-gradient-to-r from-violet-500 to-indigo-400'"
              :style="{ width: `${user.isLimit ? Math.min(100, user.usagePercent) : Math.min(100, user.share)}%` }"
            ></div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
            <div class="flex gap-3 font-mono">
              <span>↑ 上传 {{ formatBytes(user.uplink) }}</span>
              <span>↓ 下载 {{ formatBytes(user.downlink) }}</span>
            </div>
            <span v-if="user.isLimit" :class="user.usagePercent > 90 ? 'text-rose-400' : 'text-slate-400'">
              已使用 {{ user.usagePercent.toFixed(1) }}%
            </span>
            <span v-else class="text-violet-400/80 font-medium">
              全网占比 {{ percentage(user.share) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Protocol Breakdown Section (Displayed only when real protocol telemetry is present) -->
    <div v-if="protocols && protocols.length > 0" class="border-t border-slate-800/80 pt-5 space-y-3">
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium text-slate-300 flex items-center gap-1.5">
          <span>⚡ 协议分流概览</span>
          <span class="text-[10px] text-slate-500">(Protocol Breakdown)</span>
        </span>
        <span class="text-[11px] text-slate-400">单端口 2096 双协议复用</span>
      </div>

      <!-- Segmented Bar -->
      <div class="h-3 w-full rounded-full bg-slate-800 overflow-hidden flex" role="progressbar">
        <div
          class="h-full bg-sky-400 transition-all duration-500"
          :style="{ width: `${hy2Share}%` }"
          :title="`Hysteria 2: ${formatBytes(hy2Total)} (${percentage(hy2Share)})`"
        ></div>
        <div
          class="h-full bg-emerald-400 transition-all duration-500"
          :style="{ width: `${vlessShare}%` }"
          :title="`VLESS-Reality: ${formatBytes(vlessTotal)} (${percentage(vlessShare)})`"
        ></div>
      </div>

      <!-- Legend -->
      <div class="flex items-center justify-between text-xs pt-0.5">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-sky-400"></span>
          <span class="text-slate-300 font-medium">Hysteria 2</span>
          <span class="text-slate-400 font-mono text-[11px]">{{ formatBytes(hy2Total) }}</span>
          <span class="text-slate-500 text-[11px]">({{ percentage(hy2Share) }})</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
          <span class="text-slate-300 font-medium">VLESS-Reality</span>
          <span class="text-slate-400 font-mono text-[11px]">{{ formatBytes(vlessTotal) }}</span>
          <span class="text-slate-500 text-[11px]">({{ percentage(vlessShare) }})</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatBytes } from '../api'

const props = defineProps({
  users: { type: Array, default: () => [] },
  protocols: { type: Array, default: () => [] }
})

const total = computed(() => props.users.reduce((sum, u) => sum + (u.uplink || 0) + (u.downlink || 0), 0))

const userRows = computed(() => {
  return props.users.map(u => {
    const userTotal = (u.uplink || 0) + (u.downlink || 0)
    const limit = u.traffic_limit_bytes || 0
    const isLimit = limit > 0
    const usagePercent = isLimit ? (userTotal / limit) * 100 : 0
    const share = total.value > 0 ? (userTotal / total.value) * 100 : 0
    return {
      ...u,
      total: userTotal,
      isLimit,
      usagePercent,
      share
    }
  }).sort((a, b) => b.total - a.total)
})

const hy2Item = computed(() => props.protocols.find(p => p.id === 'hy2'))
const vlessItem = computed(() => props.protocols.find(p => p.id === 'vless'))

const hy2Total = computed(() => (hy2Item.value?.uplink || 0) + (hy2Item.value?.downlink || 0))
const vlessTotal = computed(() => (vlessItem.value?.uplink || 0) + (vlessItem.value?.downlink || 0))
const protoTotal = computed(() => hy2Total.value + vlessTotal.value)

const hy2Share = computed(() => protoTotal.value > 0 ? (hy2Total.value / protoTotal.value) * 100 : 50)
const vlessShare = computed(() => protoTotal.value > 0 ? (vlessTotal.value / protoTotal.value) * 100 : 50)

const percentage = value => value > 0 && value < 0.1 ? '<0.1%' : `${Number(value.toFixed(1))}%`
</script>
