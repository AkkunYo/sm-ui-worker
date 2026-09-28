<template>
  <div class="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
    <div>
      <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white">集群全景概览</h1>
      <p class="text-xs sm:text-sm text-slate-400 mt-0.5">实时监控多节点状态与流量负载指标</p>
    </div>

    <div v-if="overviewError" role="alert" class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs sm:text-sm text-rose-300">
      {{ overviewError }}<span v-if="overviewLoaded">，当前展示上次成功获取的数据。</span>
      <button type="button" :disabled="overviewLoading" @click="loadData" class="ml-3 underline disabled:opacity-50">重试</button>
    </div>
    <PageSkeleton v-if="!overviewLoaded && !overviewError" label="正在加载主机概览…" />
    <template v-if="overviewLoaded">
    <!-- Stat Grid (Compact) -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="p-3.5 px-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">主机在线率</p>
          <p class="text-lg sm:text-xl font-bold text-white mt-0.5">
            <span class="text-emerald-400">{{ onlineNodesCount }}</span> / {{ enabledNodes.length }}
          </p>
        </div>
        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
          <Server class="w-4 h-4" />
        </div>
      </div>

      <div class="p-3.5 px-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">订阅状态</p>
          <p class="text-lg sm:text-xl font-bold text-white mt-0.5">{{ subscriptionActive ? '正常' : '不可用' }}</p>
        </div>
        <div class="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
          <Link2 class="w-4 h-4" />
        </div>
      </div>

      <div class="p-3.5 px-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">全网总上传</p>
          <p class="text-lg sm:text-xl font-bold text-white mt-0.5">{{ formatBytes(totalUpload) }}</p>
        </div>
        <div class="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
          <ArrowUpRight class="w-4 h-4" />
        </div>
      </div>

      <div class="p-3.5 px-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">全网总下载</p>
          <p class="text-lg sm:text-xl font-bold text-white mt-0.5">{{ formatBytes(totalDownload) }}</p>
        </div>
        <div class="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
          <ArrowDownRight class="w-4 h-4" />
        </div>
      </div>
    </div>

    <!-- Active Nodes Quick View (Compact Strip List) -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-base font-semibold text-white">主机列表 <span class="ml-1 text-sm font-normal text-slate-400">Node Hosts</span></h2>
          <p class="text-xs text-slate-400 mt-0.5">自动同步各 VPS 反向长连状态与心跳</p>
        </div>
        <router-link to="/nodes" class="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition">
          管理全部主机 &rarr;
        </router-link>
      </div>

      <div v-if="enabledNodes.length === 0" class="text-center py-8 text-slate-500 text-sm">
        暂无接入主机，请前往“节点主机”添加第一个主机。
      </div>

      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div
          v-for="node in enabledNodes"
          :key="node.id"
          class="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-colors gap-3"
        >
          <!-- Left: Status & Name & IP -->
          <div class="flex items-center gap-3 min-w-0">
            <span class="relative flex h-2.5 w-2.5 shrink-0">
              <span
                v-if="node.status === 'online'"
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
              ></span>
              <span
                :class="node.status === 'online' ? 'bg-emerald-500' : 'bg-rose-500'"
                class="relative inline-flex rounded-full h-2.5 w-2.5"
              ></span>
            </span>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-white truncate">{{ node.name }}</p>
              <p class="text-xs font-mono text-slate-400 truncate">{{ node.server_ip }}:{{ node.proxy_port }}</p>
            </div>
          </div>

          <!-- Right: Stats & Latency -->
          <div class="flex items-center gap-3 shrink-0">
            <!-- CPU & Mem mini meters -->
            <div class="hidden sm:flex items-center gap-3 text-xs text-slate-400">
              <div class="flex items-center gap-1.5">
                <span class="text-slate-500">CPU</span>
                <span class="font-mono text-slate-300 min-w-[28px] text-right">{{ node.cpu_percent ? node.cpu_percent.toFixed(0) : 0 }}%</span>
                <div class="w-10 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="node.cpu_percent > 80 ? 'bg-rose-500' : node.cpu_percent > 50 ? 'bg-amber-500' : 'bg-emerald-500'"
                    :style="{ width: `${Math.min(100, Math.max(0, node.cpu_percent || 0))}%` }"
                  ></div>
                </div>
              </div>

              <div class="flex items-center gap-1.5">
                <span class="text-slate-500">RAM</span>
                <span class="font-mono text-slate-300 min-w-[28px] text-right">{{ node.memory_percent ? node.memory_percent.toFixed(0) : 0 }}%</span>
                <div class="w-10 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="node.memory_percent > 80 ? 'bg-rose-500' : node.memory_percent > 50 ? 'bg-amber-500' : 'bg-blue-500'"
                    :style="{ width: `${Math.min(100, Math.max(0, node.memory_percent || 0))}%` }"
                  ></div>
                </div>
              </div>
            </div>

            <!-- Latency Pill -->
            <span
              class="px-2 py-0.5 rounded text-xs font-mono font-medium"
              :class="node.status === 'online' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'"
            >
              {{ node.status === 'online' ? `${node.rtt_ms || 0} ms` : '离线' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    </template>
    <section aria-labelledby="traffic-heading" class="space-y-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="traffic-heading" class="text-base font-semibold text-white">流量分布</h2>
          <p class="mt-1 text-xs text-slate-400">累计代理物理流量 · 包含上传与下载 · 每 30 秒更新</p>
        </div>
        <span v-if="traffic && !trafficError" class="text-xs text-slate-400">全网累计 <strong class="ml-1 font-medium text-slate-200 tabular-nums">{{ formatBytes(traffic.total.uplink + traffic.total.downlink) }}</strong></span>
      </div>
      <div v-if="trafficError" role="alert" class="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300">
        <span>流量统计暂时不可用{{ traffic ? '，当前展示上次成功获取的数据' : '' }}。</span>
        <button type="button" class="shrink-0 underline underline-offset-4 hover:text-amber-100 disabled:opacity-50" :disabled="trafficLoading" @click="loadTraffic">重试</button>
      </div>
      <div v-if="!traffic && !trafficError" class="grid grid-cols-1 lg:grid-cols-2 gap-5" role="status" aria-label="正在加载流量分布">
        <div v-for="title in ['主机负载分布', '租户流量使用']" :key="title" class="h-96 rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <h3 class="text-sm font-semibold text-white">{{ title }}</h3>
          <div class="mx-auto my-12 h-40 w-40 animate-pulse motion-reduce:animate-none rounded-full border-[14px] border-slate-800"></div>
        </div>
      </div>
      <div v-if="traffic" class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <HostTrafficCard :hosts="traffic.hosts" />
        <TenantTrafficCard :users="traffic.users" :protocols="traffic.protocols" />
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Server, Link2, ArrowUpRight, ArrowDownRight } from 'lucide-vue-next'
import { formatBytes } from '../api'
import HostTrafficCard from '../components/HostTrafficCard.vue'
import TenantTrafficCard from '../components/TenantTrafficCard.vue'
import PageSkeleton from '../components/PageSkeleton.vue'
import { usePageRead } from '../composables/usePageRead'
const readPage = usePageRead()

const nodes = ref([])
const overviewLoaded = ref(false)
const overviewLoading = ref(false)
const overviewError = ref('')
const profile = ref({})
const subscriptionActive = ref(false)
const traffic = ref(null)
const trafficError = ref(false)
const trafficLoading = ref(false)
let refreshTimer = null

const enabledNodes = computed(() => nodes.value.filter(n => n.status !== 'disabled'))
const onlineNodesCount = computed(() => enabledNodes.value.filter(n => n.status === 'online' && n.core_state === 'running' && n.config_status === 'applied').length)
const totalUpload = computed(() => traffic.value?.total.uplink ?? profile.value.used_up_bytes ?? 0)
const totalDownload = computed(() => traffic.value?.total.downlink ?? profile.value.used_down_bytes ?? 0)

async function loadTraffic() {
  if (trafficLoading.value) return
  trafficLoading.value = true
  try {
    const data = await readPage('/api/v1/traffic')
    if (!data?.total || !Array.isArray(data.hosts) || !Array.isArray(data.protocols) || !Array.isArray(data.users)) throw new Error('流量统计响应无效')
    traffic.value = data
    trafficError.value = false
  } catch (err) {
    if (err.name !== 'AbortError') trafficError.value = true
  } finally {
    trafficLoading.value = false
  }
}

async function loadData() {
  if (overviewLoading.value) return
  overviewLoading.value = true
  if (!overviewLoaded.value) overviewError.value = ''
  try {
    // Keep this refresh in flight until both reads finish, even when one fails early.
    const results = await Promise.allSettled([
      readPage('/api/v1/nodes'),
      readPage('/api/v1/subscription')
    ])
    const failed = results.find(result => result.status === 'rejected')
    if (failed) throw failed.reason
    const [nodesData, usersData] = results.map(result => result.value)
    if (!Array.isArray(nodesData) || !usersData?.profile) throw new Error('主机概览响应无效')
    nodes.value = nodesData
    profile.value = usersData.profile
    subscriptionActive.value = usersData.active
    overviewLoaded.value = true
    overviewError.value = ''
  } catch (err) {
    if (err.name !== 'AbortError') overviewError.value = err.message || '加载主机概览失败'
  } finally {
    overviewLoading.value = false
  }
}

function refreshData() {
  loadData()
  loadTraffic()
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  } else {
    refreshData()
    if (!refreshTimer) {
      refreshTimer = setInterval(refreshData, 30000)
    }
  }
}

onMounted(() => {
  refreshData()
  refreshTimer = setInterval(refreshData, 30000)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>
