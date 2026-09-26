<template>
  <div class="p-4 sm:p-8 space-y-8 max-w-4xl mx-auto">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-white flex items-center space-x-2.5">
        <span>协议模板配置 (Inbound)</span>
      </h1>
      <p class="text-sm text-slate-400 mt-1">
        统一配置 VLESS REALITY 和 Hysteria 2 带宽，应用到接入主机。
      </p>
    </div>

    <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-8 shadow-2xl">
      <PageSkeleton v-if="loading" label="正在读取协议模板…" />
      <div v-else-if="loadError" class="text-sm text-rose-300" role="alert">
        {{ loadError }}
        <button type="button" @click="loadTemplate" class="ml-2 underline">重新加载</button>
      </div>
      <form v-else @submit.prevent="saveTemplate" class="space-y-6">
        <fieldset :disabled="loading || !!loadError || saving" class="space-y-6 disabled:opacity-60">
        <!-- VLESS REALITY Section -->
        <div class="space-y-4">
          <div class="flex flex-wrap gap-3 items-center justify-between border-b border-slate-800/80 pb-3">
            <h2 class="text-base font-semibold text-white flex items-center space-x-2">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>VLESS + REALITY 伪装目标配置</span>
            </h2>
            <button
              type="button"
              @click="openSniModal"
              class="px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
            >
              <Globe class="w-3.5 h-3.5" />
              <span>选择推荐 SNI (预设库)</span>
            </button>
          </div>

          <!-- Input Fields for SNI and Dest -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  伪装域名 (Server Name / SNI) <span class="text-rose-400">*</span>
                </label>
              </div>
              <input
                v-model="template.reality_server_name"
                type="text"
                required
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none transition"
                placeholder="例如: www.amazon.com"
              />
              <p class="text-[11px] text-slate-500 mt-1">客户端握手目标 SNI 伪装域名</p>
            </div>

            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  回落目标 (Dest) <span class="text-rose-400">*</span>
                </label>
              </div>
              <input
                v-model="template.reality_dest"
                type="text"
                required
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none transition"
                placeholder="例如: www.amazon.com:443"
              />
              <p class="text-[11px] text-slate-500 mt-1">非法探测握手时的真实回落网站与端口</p>
            </div>
          </div>
        </div>

        <section class="space-y-4">
          <h2 class="text-base font-semibold text-white border-b border-slate-800/80 pb-3 flex items-center gap-2">
            <Zap class="w-4 h-4 text-blue-400" />
            Hysteria 2 带宽
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label for="hy2-up" class="block text-xs font-semibold text-slate-300 mb-1.5">服务器上行 (Mbps)</label>
              <input id="hy2-up" v-model.number="template.hy2_up_mbps" type="number" min="0" max="2147483647" step="1" required
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-blue-500 focus:outline-none" />
              <p class="text-[11px] text-slate-500 mt-1">服务器发送，对应客户端的下载方向</p>
            </div>
            <div>
              <label for="hy2-down" class="block text-xs font-semibold text-slate-300 mb-1.5">服务器下行 (Mbps)</label>
              <input id="hy2-down" v-model.number="template.hy2_down_mbps" type="number" min="0" max="2147483647" step="1" required
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-blue-500 focus:outline-none" />
              <p class="text-[11px] text-slate-500 mt-1">服务器接收，对应客户端的上传方向</p>
            </div>
          </div>
          <p class="text-xs text-slate-400">每台主机使用相同设置。填写非负整数；0 表示不设置该方向的带宽上限，实际速度取决于线路与拥塞控制。</p>
        </section>

        <!-- Built-in System Managed Cards -->
        <div class="space-y-3 pt-2">
          <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider">系统内置自动化管理项</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <!-- Reality Keypair Card -->
            <div class="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-1.5">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2 text-xs font-semibold text-slate-200">
                  <ShieldCheck class="w-4 h-4 text-emerald-400" />
                  <span>X25519 签名密钥</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  默认内置 · 免维护
                </span>
              </div>
              <p class="text-[11px] text-slate-400 leading-relaxed">
                遵循 RFC 7748 X25519 标准私钥、公钥与 16 位 ShortID。密钥全链路自动注入客户端订阅，无需手动输入或粘贴。
              </p>
            </div>

            <!-- Hysteria 2 Card -->
            <div class="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-1.5">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2 text-xs font-semibold text-slate-200">
                  <Zap class="w-4 h-4 text-blue-400" />
                  <span>Hysteria 2 高速传输</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  默认内置 · 自动签发
                </span>
              </div>
              <p class="text-[11px] text-slate-400 leading-relaxed">
                自签名 TLS 证书由系统自动生成。Hy2 使用 UDP，与 VLESS 的 TCP 监听共用业务端口号。
              </p>
            </div>
          </div>
        </div>

        <!-- Submit Button -->
        <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between pt-6 border-t border-slate-800">
          <p class="text-xs text-slate-500">保存后下发配置，离线主机重连后同步。配置变化会重启代理核心，现有连接会中断。</p>
          <button
            type="submit"
            :disabled="saving"
            class="shrink-0 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition disabled:opacity-50 shadow-lg shadow-emerald-500/20 flex items-center space-x-2"
          >
            <span v-if="saving">正在保存…</span>
            <span v-else>保存并下发配置</span>
          </button>
        </div>
        </fieldset>
        <p v-if="saveError" class="text-sm text-rose-300" role="alert">{{ saveError }}</p>
        <p v-if="saved" class="text-sm text-emerald-300" role="status">模板已保存并下发，请在主机状态中确认应用结果。</p>
      </form>
    </div>

    <!-- SNI Selection Modal -->
    <Teleport to="body">
      <div
        v-if="showSniModal"
        @click.self="showSniModal = false"
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      >
        <div class="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl p-6 shadow-2xl space-y-5">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-bold text-white flex items-center space-x-2">
                <Globe class="w-5 h-5 text-emerald-400" />
                <span>选择推荐 REALITY 伪装域名 (SNI)</span>
              </h2>
              <p class="text-xs text-slate-400 mt-0.5">参考 3x-ui 推荐列表，点击任一域名即可自动填入 SNI 与 Dest</p>
            </div>
            <button @click="showSniModal = false" class="text-slate-400 hover:text-white">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Search Filter Input -->
          <div class="relative">
            <input
              v-model="sniSearch"
              type="text"
              placeholder="搜索预设域名，如 amazon / apple / cloudflare / microsoft..."
              class="w-full px-4 py-2.5 pl-10 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition font-mono"
            />
            <Search class="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          </div>

          <!-- Presets List -->
          <div class="max-h-80 overflow-y-auto divide-y divide-slate-800/80 border border-slate-800 rounded-2xl bg-slate-950/40">
            <div
              v-for="preset in filteredPresets"
              :key="preset.sni"
              @click="applyPresetAndClose(preset)"
              class="p-3.5 flex items-center justify-between hover:bg-slate-800/50 cursor-pointer transition group"
              :class="template.reality_server_name === preset.sni ? 'bg-emerald-500/10' : ''"
            >
              <div class="space-y-0.5">
                <div class="flex items-center space-x-2">
                  <span class="font-mono text-xs font-semibold text-white group-hover:text-emerald-300 transition">
                    {{ preset.sni }}
                  </span>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300">
                    {{ preset.label }}
                  </span>
                  <span
                    v-if="template.reality_server_name === preset.sni"
                    class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  >
                    当前选用
                  </span>
                </div>
                <div class="text-[11px] text-slate-500 font-mono">
                  Dest: <code class="text-slate-400">{{ preset.dest }}</code> · {{ preset.desc }}
                </div>
              </div>

              <button
                type="button"
                @click.stop="applyPresetAndClose(preset)"
                class="px-3 py-1.5 rounded-lg text-xs font-medium transition"
                :class="template.reality_server_name === preset.sni
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'bg-slate-800 text-slate-300 hover:bg-emerald-500 hover:text-slate-950 group-hover:bg-emerald-500 group-hover:text-slate-950'"
              >
                <span v-if="template.reality_server_name === preset.sni">已选用</span>
                <span v-else>选用</span>
              </button>
            </div>

            <div v-if="filteredPresets.length === 0" class="p-8 text-center text-xs text-slate-500">
              未搜索到匹配的预设域名，可在主页面直接输入任意自定义域名。
            </div>
          </div>

          <div class="flex justify-end pt-1">
            <button
              type="button"
              @click="showSniModal = false"
              class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Search, Globe, ShieldCheck, Zap, X } from 'lucide-vue-next'
import { request } from '../api'
import PageSkeleton from '../components/PageSkeleton.vue'
import { usePageRead } from '../composables/usePageRead'
const readPage = usePageRead()

const template = ref({
  reality_dest: 'www.amazon.com:443',
  reality_server_name: 'www.amazon.com',
  reality_private_key: '',
  reality_public_key: '',
  reality_short_id: '',
  hy2_up_mbps: 100,
  hy2_down_mbps: 100
})

const showSniModal = ref(false)
const sniSearch = ref('')
const saving = ref(false)
const loading = ref(true)
const loadError = ref('')
const saveError = ref('')
const saved = ref(false)

// 3x-ui standard recommended TLS 1.3 Reality domains with descriptive context
const presets = [
  { sni: 'www.amazon.com', dest: 'www.amazon.com:443', label: '亚马逊 · 首选', desc: '3x-ui 默认首选，全国各地直连稳定性极高' },
  { sni: 'aws.amazon.com', dest: 'aws.amazon.com:443', label: 'AWS 官网', desc: 'AWS 全球 Anycast CDN，大流量不易引起注意' },
  { sni: 'itunes.apple.com', dest: 'itunes.apple.com:443', label: '苹果 iTunes', desc: '苹果核心域名，运营商白名单，TLS 1.3 完备' },
  { sni: 'swdist.apple.com', dest: 'swdist.apple.com:443', label: '苹果 CDN', desc: '苹果软件更新分发节点，极度适合大流量掩护' },
  { sni: 'gateway.icloud.com', dest: 'gateway.icloud.com:443', label: '苹果 iCloud', desc: '苹果 iCloud 实时网关，支持长期常驻连接' },
  { sni: 'www.microsoft.com', dest: 'www.microsoft.com:443', label: '微软官网', desc: '微软全球官方入口，国内直连速度快' },
  { sni: 'addons.mozilla.org', dest: 'addons.mozilla.org:443', label: '火狐扩展', desc: 'Mozilla 全球分发中心，纯净白名单' },
  { sni: 'dl.google.com', dest: 'dl.google.com:443', label: '谷歌下载', desc: '谷歌中国 CDN 节点，国内部分省份直连畅通' },
  { sni: 'www.cloudflare.com', dest: 'www.cloudflare.com:443', label: 'Cloudflare', desc: 'Cloudflare 官方门户，支持 TLS 1.3' },
  { sni: 'www.yahoo.com', dest: 'www.yahoo.com:443', label: '雅虎官网', desc: '老牌门户，全球 CDN 节点丰富' },
  { sni: 'www.samsung.com', dest: 'www.samsung.com:443', label: '三星官网', desc: 'Akamai 边缘分发，国内访问质量优秀' }
]

const filteredPresets = computed(() => {
  const q = sniSearch.value.trim().toLowerCase()
  if (!q) return presets
  return presets.filter(p => p.sni.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q))
})

function openSniModal() {
  sniSearch.value = ''
  showSniModal.value = true
}

function applyPresetAndClose(preset) {
  template.value.reality_server_name = preset.sni
  template.value.reality_dest = preset.dest
  showSniModal.value = false
}

async function loadTemplate() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await readPage('/api/v1/template')
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('模板响应无效')
    if (data) {
      template.value = data
      if (!template.value.reality_server_name) {
        template.value.reality_server_name = 'www.amazon.com'
        template.value.reality_dest = 'www.amazon.com:443'
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return
    loadError.value = err.message || '读取模板失败'
  } finally {
    loading.value = false
  }
}

async function saveTemplate() {
  if (loading.value || loadError.value || saving.value) return
  saved.value = false
  saveError.value = ''
  for (const value of [template.value.hy2_up_mbps, template.value.hy2_down_mbps]) {
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
      saveError.value = 'Hy2 带宽必须为 0 到 2147483647 之间的整数 Mbps'
      return
    }
  }
  saving.value = true
  try {
    await request('/api/v1/template', {
      method: 'PUT',
      body: JSON.stringify({
        reality_server_name: template.value.reality_server_name,
        reality_dest: template.value.reality_dest,
        hy2_up_mbps: template.value.hy2_up_mbps,
        hy2_down_mbps: template.value.hy2_down_mbps
      })
    })
    saved.value = true
    await loadTemplate()
  } catch (err) {
    saveError.value = err.message || '保存模板失败'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadTemplate()
})
</script>
