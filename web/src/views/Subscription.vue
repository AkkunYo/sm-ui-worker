<template>
  <div class="subscription-page p-4 md:p-8 max-w-6xl mx-auto space-y-6">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="rounded-2xl p-3 bg-violet-500/15 text-violet-300"><Link2 class="w-6 h-6" /></div>
        <div><h1 class="text-2xl font-bold text-white">订阅链接</h1><p class="text-sm text-slate-400 mt-1">一份订阅，连接全部节点</p></div>
      </div>
      <button class="sub-button" :disabled="loading" @click="load()"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />刷新</button>
    </header>
    <div v-if="error" role="alert" class="rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4">
      {{ error }}<span v-if="profile">，当前展示上次成功获取的数据。</span>
      <button type="button" :disabled="loading" @click="load()" class="ml-3 underline disabled:opacity-50">重试</button>
    </div>
    <p v-if="notice" role="status" class="rounded-xl bg-violet-500/10 text-violet-200 p-3">{{ notice }}</p>

    <!-- Admin Subscription Control Bar (Option B & C) -->
    <div v-if="isAdmin" class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center space-x-2 text-sm font-semibold text-white">
          <Sparkles class="w-4 h-4 text-violet-400" />
          <span>超级管理员视角控制</span>
        </div>
        <span class="text-xs text-slate-400">支持全集群聚合测速巡检，以及免登代客预览与分发</span>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <!-- Mode Switch Segments -->
        <div class="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs">
          <button
            type="button"
            @click="setAdminMode('all')"
            class="px-3.5 py-1.5 rounded-lg font-medium transition"
            :class="adminMode === 'all' ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-slate-400 hover:text-white'"
          >
            ⚡️ 全网节点聚合 (God-mode)
          </button>
          <button
            type="button"
            @click="setAdminMode('admin')"
            class="px-3.5 py-1.5 rounded-lg font-medium transition"
            :class="adminMode === 'admin' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'"
          >
            👤 超管自用节点
          </button>
          <button
            type="button"
            @click="setAdminMode('tenant')"
            class="px-3.5 py-1.5 rounded-lg font-medium transition"
            :class="adminMode === 'tenant' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:text-white'"
          >
            👥 租户专属预览
          </button>
        </div>

        <!-- Tenant Selector for Preview Mode -->
        <div v-if="adminMode === 'tenant'" class="flex items-center space-x-2">
          <select
            v-model="selectedTenantId"
            @change="onTenantSelected"
            class="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none"
          >
            <option disabled value="">选择要预览的租户…</option>
            <option v-for="t in tenantsList" :key="t.id" :value="t.id">
              {{ t.username }} ({{ t.node_count || 0 }} 台主机)
            </option>
          </select>
        </div>
      </div>

      <!-- Active Mode Description -->
      <div v-if="adminMode === 'all'" class="px-3.5 py-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300 leading-relaxed flex items-center justify-between">
        <span>⚡️ <strong>全网节点聚合巡检模式</strong>：当前订阅已聚合全集群所有租户的在线节点（共 {{ links.length }} 个配置），由超管凭据鉴权，可直接导入客户端测速巡检。</span>
      </div>
      <div v-else-if="adminMode === 'tenant' && selectedTenantId" class="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 leading-relaxed flex items-center justify-between">
        <span>👀 <strong>代客预览模式</strong>：当前正在代客预览租户 <strong>[{{ profile?.username }}]</strong> 的专属订阅内容。复制链接或二维码即可直接发给该租户使用。</span>
      </div>
    </div>

    <PageSkeleton v-if="!profile && !error" label="正在加载订阅…" :rows="4" />
    <template v-if="profile">
      <!-- Empty Hosts Warning Banner -->
      <div v-if="links.length === 0" role="status" class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
            <Server class="w-5 h-5" />
          </div>
          <div>
            <p class="text-sm font-semibold text-white">暂未接入任何节点主机</p>
            <p class="text-xs text-amber-300/80 mt-0.5">当前尚未添加 VPS 主机实例。请先前往“节点主机”添加并接入您的首台机器，连接成功后订阅配置将自动生效并包含节点。</p>
          </div>
        </div>
        <router-link to="/nodes" class="sub-button sub-primary whitespace-nowrap text-xs">
          前往添加接入主机 &rarr;
        </router-link>
      </div>

      <section class="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-950/50 to-slate-900 p-6 md:p-8 flex flex-col sm:flex-row gap-8 items-center">
        <div class="relative w-40 h-40 shrink-0">
          <svg viewBox="0 0 120 120" class="w-full h-full -rotate-90" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="#312648" stroke-width="7" /><circle cx="60" cy="60" r="52" fill="none" :stroke="active ? '#a78bfa' : '#fb7185'" stroke-width="7" stroke-linecap="round" :stroke-dasharray="`${percent * 3.267} 326.7`" /></svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center"><span class="text-3xl font-semibold text-white">{{ profile.traffic_limit_bytes ? `${percent.toFixed(1)}%` : '∞' }}</span><span class="text-xs text-slate-400 mt-1">{{ profile.traffic_limit_bytes ? '已使用' : '不限流量' }}</span></div>
        </div>
        <div class="flex-1 w-full">
          <p class="text-sm text-slate-400">{{ profile.traffic_limit_bytes ? '剩余流量' : '累计使用' }}</p>
          <p class="text-4xl font-semibold tracking-tight text-white mt-2">{{ formatBytes(profile.traffic_limit_bytes ? Math.max(0, profile.traffic_limit_bytes - used) : used) }}</p>
          <dl class="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5 mt-6 text-sm">
            <div><dt>订阅状态</dt><dd :class="active ? 'text-emerald-300' : 'text-rose-300'">{{ statusText }}</dd></div>
            <div><dt>有效期</dt><dd>{{ profile.expire_at ? new Date(profile.expire_at).toLocaleDateString() : '永久有效' }}</dd></div>
            <div><dt>累计上传</dt><dd>{{ formatBytes(profile.used_up_bytes) }}</dd></div>
            <div><dt>累计下载</dt><dd>{{ formatBytes(profile.used_down_bytes) }}</dd></div>
            <div><dt>总流量配额</dt><dd>{{ profile.traffic_limit_bytes ? formatBytes(profile.traffic_limit_bytes) : '无限制' }}</dd></div>
            <div><dt>剩余天数</dt><dd>{{ daysLeft }}</dd></div>
            <div><dt>可用配置</dt><dd>{{ links.length }} 个</dd></div>
            <div><dt>凭据范围</dt><dd>全部节点共用</dd></div>
          </dl>
        </div>
      </section>
      <section class="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div role="tablist" aria-label="订阅内容" class="flex border-b border-slate-800 px-4 sm:px-6 gap-4 sm:gap-7 overflow-x-auto">
          <button v-for="item in tabs" :id="`tab-${item.id}`" :key="item.id" role="tab" :aria-selected="tab === item.id" :aria-controls="`panel-${item.id}`" class="py-4 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2" :class="tab === item.id ? 'border-violet-400 text-violet-300' : 'border-transparent text-slate-400 hover:text-white'" @click="tab = item.id"><component :is="item.icon" class="w-4 h-4" />{{ item.label }}<span v-if="item.id === 'configs'" class="text-xs px-1.5 rounded bg-slate-800">{{ links.length }}</span></button>
        </div>
        <div :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`" class="p-4 sm:p-6">
          <div v-if="tab === 'links'" class="space-y-4">
            <div v-for="item in formats" :key="item.id" class="sub-row">
              <span class="w-16 text-center text-xs font-semibold px-2 py-1 rounded border" :class="item.color">{{ item.badge }}</span>
              <div class="min-w-0 flex-1"><p class="text-sm font-medium text-white">{{ item.label }}</p><a :href="item.url" class="block text-xs font-mono text-slate-400 truncate mt-1 hover:text-violet-300" :title="item.url" target="_blank" rel="noopener noreferrer">{{ item.url }}</a></div>
              <div class="flex gap-2"><button class="sub-icon" :aria-label="`下载${item.label}`" :title="`下载${item.label}`" @click="downloadConfig(item)"><Download class="w-4 h-4" /></button><button class="sub-icon" :aria-label="`复制${item.label}`" :title="`复制${item.label}`" @click="copy(item.url)"><Copy class="w-4 h-4" /></button><button class="sub-icon" :aria-label="`${item.label}二维码`" :title="`${item.label}二维码`" @click="showQR(item.url, item.label)"><QrCode class="w-4 h-4" /></button></div>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-950/40 p-5 flex items-center gap-5">
              <img v-if="mainQR" :src="mainQR" alt="通用订阅二维码" class="w-28 h-28 rounded-lg" />
              <div><h3 class="text-sm font-medium text-white">扫码添加订阅</h3><p class="text-xs text-slate-400 leading-relaxed mt-2">使用客户端扫描二维码，或复制上方对应格式的订阅地址。</p></div>
            </div>
          </div>
          <div v-else-if="tab === 'apps'" class="space-y-5">
            <div class="inline-flex p-1 rounded-lg bg-slate-950 border border-slate-800"><button v-for="item in platforms" :key="item.id" class="px-4 py-2 text-sm rounded-md" :class="platform === item.id ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400'" @click="platform = item.id">{{ item.label }}</button></div>
            <p class="text-xs text-slate-400">安装客户端后，点击添加订阅。如果客户端未被唤起，可在“订阅链接”中复制地址手动导入。</p>
            <div class="grid sm:grid-cols-2 gap-3"><div v-for="app in apps" :key="app.name" class="sub-row"><span class="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-300 flex items-center justify-center font-semibold">{{ app.name[0] }}</span><span class="flex-1 text-sm text-white">{{ app.name }}</span><a :href="app.url" class="sub-button sub-primary">添加订阅</a></div></div>
          </div>
          <div v-else class="space-y-4">
            <div class="flex justify-between items-center gap-3"><p class="text-xs text-slate-400">单独导入某个节点，或复制全部配置。</p><button class="sub-button" :disabled="!links.length" @click="copy(links.map(link => link.uri).join('\n'))"><Copy class="w-4 h-4" />复制全部</button></div>
            <div v-if="!links.length" class="py-12 text-center text-slate-400 space-y-3">
              <Server class="w-8 h-8 text-slate-600 mx-auto" />
              <p class="text-sm">{{ active ? '暂无可用的节点配置，请先添加接入 VPS 主机。' : '订阅当前不可用，请检查订阅设置。' }}</p>
              <router-link to="/nodes" class="sub-button sub-primary inline-flex text-xs">
                前往添加接入主机 &rarr;
              </router-link>
            </div>
            <div v-for="link in links" :key="link.uri" class="sub-row"><span class="text-[10px] font-semibold px-2 py-1 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">{{ link.protocol === 'vless' ? 'VLESS' : 'HY2' }}</span><p class="text-sm text-white flex-1 truncate" :title="link.name">{{ link.name }}</p><button class="sub-icon" :aria-label="`复制${link.name}`" @click="copy(link.uri)"><Copy class="w-4 h-4" /></button><button class="sub-icon" :aria-label="`${link.name}二维码`" @click="showQR(link.uri, link.name)"><QrCode class="w-4 h-4" /></button></div>
          </div>
        </div>
        <footer class="border-t border-slate-800 px-6 py-3 text-xs text-slate-500 flex flex-wrap gap-2 justify-between"><span>建议客户端每 24 小时自动更新订阅</span><button class="text-violet-300 hover:text-violet-200" @click="openSettings">订阅设置</button></footer>
      </section>
    </template>
    <Teleport to="body">
      <div v-if="qr" class="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" @click.self="qr = null" @keydown.esc="qr = null">
        <section role="dialog" aria-modal="true" aria-labelledby="qr-title" class="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 space-y-5">
          <div class="flex justify-between gap-3"><h2 id="qr-title" class="font-semibold text-white truncate">{{ qr.label }}</h2><button class="text-slate-400" aria-label="关闭二维码" @click="qr = null"><X class="w-5 h-5" /></button></div>
          <img :src="qr.image" alt="订阅或节点二维码" class="w-60 h-60 mx-auto rounded-xl" />
          <textarea :value="qr.value" readonly aria-label="二维码对应链接" rows="3" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 break-all" />
          <div class="flex justify-center gap-3"><button class="sub-button sub-primary" @click="copy(qr.value)"><Copy class="w-4 h-4" />复制链接</button><a :href="qr.image" download="sm-ui-qrcode.png" class="sub-button"><Download class="w-4 h-4" />保存二维码</a></div>
        </section>
      </div>
      <div v-if="settingsOpen" class="fixed inset-0 z-[100] bg-slate-950/80 flex items-center justify-center p-4" @click.self="settingsOpen = false">
        <form role="dialog" aria-modal="true" aria-labelledby="settings-title" class="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-5" @submit.prevent="saveSettings">
          <div class="flex justify-between"><h2 id="settings-title" class="font-semibold text-white">订阅设置</h2><button type="button" aria-label="关闭设置" class="text-slate-400" @click="settingsOpen = false"><X class="w-5 h-5" /></button></div>
          <label class="flex items-center gap-2 text-sm text-slate-300"><input v-model="form.enabled" type="checkbox" />启用代理订阅</label>
          <label class="block text-sm text-slate-300">流量配额（GB，0 为无限制）<input v-model.number="form.limitGB" type="number" min="0" step="0.01" required class="sub-input" /></label>
          <label class="block text-sm text-slate-300">到期时间（留空为永久）<input v-model="form.expiry" type="datetime-local" class="sub-input" /></label>
          <label class="block text-sm text-slate-300">全节点代理密码<input v-model="form.password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="留空保持当前密码" class="sub-input" /></label>
          <p v-if="settingsError" role="alert" class="text-sm text-rose-300">{{ settingsError }}</p>
          <div class="flex justify-between gap-3"><button type="button" class="text-sm text-rose-300" :disabled="saving" @click="resetSubscription">重置订阅地址</button><button class="sub-button sub-primary" :disabled="saving">{{ saving ? '保存中…' : '保存设置' }}</button></div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Link2, List, AppWindow, Copy, QrCode, Download, RefreshCw, X, Server, Sparkles } from 'lucide-vue-next'
import QRCode from 'qrcode'
import { request, formatBytes, getUser } from '../api'
import PageSkeleton from '../components/PageSkeleton.vue'
import { usePageRead } from '../composables/usePageRead'
const readPage = usePageRead()

const currentUser = computed(() => getUser())
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const adminMode = ref('all') // 'all', 'admin', 'tenant'
const selectedTenantId = ref('')
const tenantsList = ref([])

const profile = ref(null), links = ref([]), active = ref(false), loading = ref(false), error = ref(''), notice = ref('')
const tab = ref('links'), platform = ref(/iphone|ipad|macintosh/i.test(navigator.userAgent) ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop')
const qr = ref(null), mainQR = ref(''), settingsOpen = ref(false), settingsError = ref(''), saving = ref(false), form = ref({})
let timer, noticeTimer
const tabs = [{ id: 'links', label: '订阅链接', icon: Link2 }, { id: 'apps', label: '客户端导入', icon: AppWindow }, { id: 'configs', label: '节点配置', icon: List }]
const platforms = [{ id: 'android', label: 'Android' }, { id: 'ios', label: 'iOS / macOS' }, { id: 'desktop', label: '桌面客户端' }]
const used = computed(() => (profile.value?.used_up_bytes || 0) + (profile.value?.used_down_bytes || 0))
const percent = computed(() => Math.min(100, used.value / (profile.value?.traffic_limit_bytes || Infinity) * 100))
const daysLeft = computed(() => profile.value?.expire_at ? Math.max(0, Math.ceil((new Date(profile.value.expire_at) - Date.now()) / 86400000)) : '∞')
const statusText = computed(() => !profile.value?.status ? '已停用' : profile.value.expire_at && new Date(profile.value.expire_at) <= new Date() ? '已到期' : !active.value ? '流量已耗尽' : '正常')
const subURL = computed(() => {
  if (!profile.value) return ''
  const base = `${window.location.origin}/sub/${encodeURIComponent(profile.value.username)}/${encodeURIComponent(profile.value.sub_token)}`
  if (isAdmin.value && adminMode.value === 'all') {
    return `${base}?all=true`
  }
  return base
})
const formats = computed(() => {
  const isAll = isAdmin.value && adminMode.value === 'all'
  const joinChar = subURL.value.includes('?') ? '&' : '?'
  return [
    { id: 'base64', badge: 'SUB', label: isAll ? '全网通用订阅' : '通用订阅', url: `${subURL.value}${joinChar}format=base64`, ext: 'txt', color: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' },
    { id: 'singbox', badge: 'JSON', label: isAll ? '全网 Sing-box' : 'Sing-box', url: `${subURL.value}${joinChar}format=singbox`, ext: 'json', color: 'bg-violet-500/10 border-violet-500/20 text-violet-300' },
    { id: 'clash', badge: 'CLASH', label: isAll ? '全网 Clash / Mihomo' : 'Clash / Mihomo', url: `${subURL.value}${joinChar}format=clash`, ext: 'yaml', color: 'bg-amber-500/10 border-amber-500/20 text-amber-300' }
  ]
})
const apps = computed(() => {
  const raw = formats.value[0].url, enc = encodeURIComponent(raw), json = encodeURIComponent(formats.value[1].url)
  const common = [{ name: 'V2Box', url: `v2box://install-sub?url=${enc}&name=SM-UI` }, { name: 'Happ', url: `happ://add/${raw}` }]
  if (platform.value === 'android') return [{ name: 'v2rayNG', url: `v2rayng://install-config?url=${enc}` }, { name: 'Sing-box', url: `sing-box://import-remote-profile?url=${json}#SM-UI` }, ...common]
  if (platform.value === 'ios') return [{ name: 'Shadowrocket', url: `shadowrocket://add/sub://${btoa(raw)}?remark=SM-UI` }, { name: 'Streisand', url: `streisand://import/${enc}` }, ...common]
  return [{ name: 'Clash / Mihomo', url: `clash://install-config?url=${encodeURIComponent(formats.value[2].url)}&name=SM-UI` }, { name: 'Sing-box', url: `sing-box://import-remote-profile?url=${json}#SM-UI` }]
})
function toast(text) { notice.value = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = '' }, 3500) }
async function copy(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value)
    else { const el = document.createElement('textarea'); el.value = value; el.style.position = 'fixed'; el.style.opacity = '0'; document.body.appendChild(el); el.select(); const ok = document.execCommand('copy'); el.remove(); if (!ok) throw new Error('copy') }
    toast('已复制到剪贴板')
  } catch { error.value = '复制失败，请手动选择链接复制。' }
}
async function showQR(value, label) {
  try { qr.value = { value, label, image: await QRCode.toDataURL(value, { width: 480, margin: 3, errorCorrectionLevel: 'M' }) } }
  catch { error.value = '链接过长，无法生成二维码，请复制链接导入。' }
}

async function loadTenants() {
  if (!isAdmin.value) return
  try {
    const list = await request('/api/v1/users')
    if (Array.isArray(list)) {
      tenantsList.value = list
    }
  } catch (e) {}
}

function setAdminMode(mode) {
  adminMode.value = mode
  if (mode === 'tenant' && !selectedTenantId.value && tenantsList.value.length > 0) {
    const firstTenant = tenantsList.value.find(t => t.id !== currentUser.value?.id) || tenantsList.value[0]
    selectedTenantId.value = firstTenant?.id || ''
  }
  load()
}

function onTenantSelected() {
  load()
}

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    let url = '/api/v1/subscription'
    if (isAdmin.value) {
      if (adminMode.value === 'all') {
        url = '/api/v1/subscription?all=true'
      } else if (adminMode.value === 'tenant' && selectedTenantId.value) {
        url = `/api/v1/subscription?user_id=${selectedTenantId.value}`
      }
    }
    const data = await readPage(url)
    if (!data?.profile) throw new Error('未找到订阅配置')
    const changed = profile.value?.sub_token !== data.profile.sub_token || links.value.length !== (data.links || []).length
    profile.value = data.profile; active.value = data.active; links.value = data.links || []; error.value = ''
    if (changed || !mainQR.value) mainQR.value = await QRCode.toDataURL(formats.value[0].url, { width: 224, margin: 2 })
  } catch (e) { if (e.name !== 'AbortError') error.value = e.message || '加载订阅失败' }
  finally { loading.value = false }
}
async function downloadConfig(item) {
  try { const res = await fetch(item.url); if (!res.ok) throw new Error('下载失败'); const blobURL = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = blobURL; a.download = `sm-ui-${item.id}.${item.ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(blobURL), 1000) }
  catch (e) { error.value = e.message }
}
function openSettings() {
  const expiry = profile.value.expire_at ? new Date(profile.value.expire_at) : null
  form.value = { enabled: profile.value.status === 1, limitGB: profile.value.traffic_limit_bytes / 1073741824, expiry: expiry ? new Date(expiry - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '', password: '' }
  settingsError.value = ''; settingsOpen.value = true
}
async function saveSettings() {
  saving.value = true; settingsError.value = ''
  try {
    const payload = { status: form.value.enabled ? 1 : 0, traffic_limit_bytes: Math.round(form.value.limitGB * 1073741824), clear_expiry: !form.value.expiry }
    if (form.value.expiry) payload.expire_at = new Date(form.value.expiry).toISOString()
    if (form.value.password) payload.password = form.value.password
    await request('/api/v1/subscription', { method: 'PUT', body: JSON.stringify(payload) }); settingsOpen.value = false; await load(); toast('订阅设置已保存')
  } catch (e) { settingsError.value = e.message } finally { saving.value = false }
}
async function resetSubscription() {
  if (!confirm('重置后旧订阅地址将失效，客户端需要重新导入。是否继续？')) return
  saving.value = true
  try { await request('/api/v1/subscription', { method: 'PUT', body: JSON.stringify({ reset_subscription: true }) }); settingsOpen.value = false; await load(); toast('订阅地址已重置') }
  catch (e) { settingsError.value = e.message } finally { saving.value = false }
}
onMounted(() => {
  load()
  loadTenants()
  timer = setInterval(load, 10000)
})
onUnmounted(() => { clearInterval(timer); clearTimeout(noticeTimer) })
</script>

<style scoped>
.sub-button { @apply inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-violet-400/50 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed; }
.sub-primary { @apply bg-violet-500/20 border-violet-500/40 text-violet-200 hover:bg-violet-500/30; }
.sub-icon { @apply p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-violet-300 hover:border-violet-400/50 transition; }
.sub-row { @apply flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3 sm:p-4; }
.sub-input { @apply block w-full mt-2 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white focus:border-violet-400 focus:outline-none; }
dt { @apply text-xs text-slate-400; } dd { @apply mt-1.5 font-medium; }
</style>
