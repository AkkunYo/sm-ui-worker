<template>
  <div class="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 flex flex-col justify-between space-y-4">
    <!-- Header -->
    <div>
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-violet-400"></span>
            <span>各租户流量使用 (Tenant Quota)</span>
          </h3>
          <p class="mt-0.5 text-xs text-slate-400">租户配额管控与实际使用明细</p>
        </div>
        <span class="rounded-lg border border-slate-700/70 bg-slate-800/60 px-2 py-0.5 text-[11px] font-mono text-slate-300">
          {{ users.length }} 位租户
        </span>
      </div>

      <!-- Tenant Quota High Density Cards -->
      <div class="mt-3.5 space-y-2.5">
        <div
          v-for="user in userRows"
          :key="user.id"
          class="p-3 rounded-xl bg-slate-950/40 border border-slate-800/70 hover:border-slate-700/70 transition space-y-2"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-6 h-6 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300 text-[11px] font-bold uppercase shrink-0">
                {{ user.name.slice(0, 2) }}
              </div>
              <span class="font-medium text-xs text-white truncate">{{ user.name }}</span>
            </div>
            <div class="text-right font-mono text-xs tabular-nums">
              <span class="font-semibold text-slate-200">{{ formatBytes(user.total) }}</span>
              <span class="text-slate-500 text-xs mx-1">/</span>
              <span class="text-slate-400 text-[11px]">{{ user.traffic_limit_bytes > 0 ? formatBytes(user.traffic_limit_bytes) : '不限流量' }}</span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="user.isLimit ? (user.usagePercent > 90 ? 'bg-rose-500' : user.usagePercent > 70 ? 'bg-amber-500' : 'bg-violet-500') : 'bg-gradient-to-r from-violet-500 to-indigo-400'"
              :style="{ width: `${user.isLimit ? Math.min(100, user.usagePercent) : Math.min(100, user.share)}%` }"
            ></div>
          </div>

          <div class="flex items-center justify-between text-[10px] text-slate-400 tabular-nums font-mono">
            <div class="flex gap-3">
              <span>↑ 上传 {{ formatBytes(user.uplink) }}</span>
              <span>↓ 下载 {{ formatBytes(user.downlink) }}</span>
            </div>
            <span v-if="user.isLimit" :class="user.usagePercent > 90 ? 'text-rose-400 font-medium' : 'text-slate-400'">
              已使用 {{ user.usagePercent.toFixed(1) }}%
            </span>
            <span v-else class="text-violet-400/90 font-medium">
              全网占比 {{ percentage(user.share) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Protocol Breakdown Section -->
    <div v-if="protocols && protocols.length > 0" class="border-t border-slate-800/80 pt-3.5 space-y-2.5">
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium text-slate-300 flex items-center gap-1.5">
          <span>⚡ 协议分流概览</span>
          <span class="text-[10px] text-slate-500">(Protocol Breakdown)</span>
        </span>
        <span class="text-[11px] text-slate-400 font-mono">单端口 2096 双协议复用</span>
      </div>

      <!-- Segmented Bar -->
      <div class="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden flex" role="progressbar">
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
          <span class="w-2 h-2 rounded-full bg-sky-400"></span>
          <span class="text-slate-300 font-medium text-xs">Hysteria 2</span>
          <span class="text-slate-400 font-mono text-[11px]">{{ formatBytes(hy2Total) }}</span>
          <span class="text-slate-500 text-[11px]">({{ percentage(hy2Share) }})</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="text-slate-300 font-medium text-xs">VLESS-Reality</span>
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
