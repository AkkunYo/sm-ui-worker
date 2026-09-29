<template>
  <div class="p-4 sm:p-8 space-y-8 max-w-6xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
          <span>协议模板池 (Inbound Templates)</span>
        </h1>
        <p class="text-sm text-slate-400 mt-1">
          三层解耦架构：协议模板池独立管理，支持 VLESS-Reality 与 Hysteria 2 单协议原子化配置，供各主机按端口插槽自由绑定。
        </p>
      </div>
      <button
        @click="openCreateModal"
        class="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 self-start sm:self-auto shrink-0"
      >
        <Plus class="w-4 h-4" />
        <span>新建协议模板</span>
      </button>
    </div>

    <!-- Error Banner -->
    <div v-if="loadError" class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 flex items-center justify-between" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" @click="loadTemplates" class="underline text-xs ml-3">重新加载</button>
    </div>

    <!-- Skeleton Loading -->
    <PageSkeleton v-if="loading" label="正在读取协议模板池…" />

    <!-- Templates Content -->
    <div v-else class="space-y-6">
      <!-- Filter Tabs -->
      <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-2 rounded-2xl">
        <div class="flex items-center space-x-1.5 overflow-x-auto">
          <button
            v-for="tab in filterTabs"
            :key="tab.id"
            @click="activeFilter = tab.id"
            class="px-3.5 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap"
            :class="activeFilter === tab.id
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
          >
            {{ tab.label }} ({{ getFilteredCount(tab.id) }})
          </button>
        </div>
        <div class="text-xs text-slate-500 hidden sm:block pr-2">
          共 {{ templates.length }} 个模板可用
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="filteredTemplates.length === 0" class="p-12 text-center rounded-3xl bg-slate-900 border border-slate-800 text-slate-500 space-y-3">
        <p class="text-sm">没有匹配的协议模板</p>
        <button
          @click="openCreateModal"
          class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition inline-flex items-center space-x-1.5"
        >
          <Plus class="w-3.5 h-3.5" />
          <span>立即创建模板</span>
        </button>
      </div>

      <!-- Template Cards Grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          v-for="tmpl in filteredTemplates"
          :key="tmpl.id"
          class="rounded-2xl border bg-slate-900/90 p-5 space-y-4 flex flex-col justify-between transition hover:border-slate-700"
          :class="tmpl.protocol === 'vless' ? 'border-emerald-500/20' : 'border-sky-500/20'"
        >
          <div class="space-y-3.5">
            <!-- Header Badges -->
            <div class="flex items-start justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <!-- Protocol Badge -->
                <span
                  v-if="tmpl.protocol === 'vless'"
                  class="px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  VLESS Reality
                </span>
                <span
                  v-else
                  class="px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-sky-500/15 text-sky-300 border border-sky-500/30 flex items-center gap-1.5"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                  Hysteria 2
                </span>

                <!-- Scope Badge -->
                <span
                  v-if="tmpl.owner_id === null"
                  class="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20"
                >
                  🌐 系统公共
                </span>
                <span
                  v-else
                  class="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20"
                >
                  🔒 租户私有<span v-if="isAdmin && tmpl.owner_username"> ({{ tmpl.owner_username }})</span>
                </span>

                <!-- Default Badge -->
                <span
                  v-if="tmpl.is_default"
                  class="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                >
                  ★ 默认
                </span>
              </div>

              <!-- Action Buttons -->
              <div class="flex items-center space-x-1 shrink-0">
                <button
                  v-if="canEdit(tmpl)"
                  @click="openEditModal(tmpl)"
                  class="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition"
                  title="编辑模板"
                >
                  <Sliders class="w-4 h-4" />
                </button>
                <button
                  v-if="canEdit(tmpl)"
                  @click="deleteTemplate(tmpl)"
                  class="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                  title="删除模板"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
                <span v-else class="text-[11px] text-slate-500 px-2 py-1">只读</span>
              </div>
            </div>

            <!-- Name -->
            <div>
              <h3 class="text-base font-semibold text-white tracking-tight">{{ tmpl.name }}</h3>
              <p class="text-[11px] text-slate-500 mt-0.5 font-mono">ID: #{{ tmpl.id }} · 更新于 {{ tmpl.updated_at || tmpl.created_at || '最近' }}</p>
            </div>

            <!-- Details Block: VLESS Reality -->
            <div v-if="tmpl.protocol === 'vless'" class="space-y-2 pt-1 text-xs">
              <div class="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 font-mono">
                <div>
                  <span class="text-slate-500 text-[10px] block">SNI 伪装域名</span>
                  <span class="text-slate-200 truncate block font-medium">{{ tmpl.reality_server_name || '未设置' }}</span>
                </div>
                <div>
                  <span class="text-slate-500 text-[10px] block">回落目标 (Dest)</span>
                  <span class="text-slate-200 truncate block font-medium">{{ tmpl.reality_dest || '未设置' }}</span>
                </div>
              </div>

              <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1.5 font-mono text-[11px]">
                <div class="flex items-center justify-between">
                  <span class="text-slate-500 text-[10px]">ShortID:</span>
                  <span class="text-slate-300 font-bold">{{ tmpl.reality_short_id || '0123456789abcdef' }}</span>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-slate-500 text-[10px] shrink-0">公钥 (Public Key):</span>
                  <span class="text-slate-400 truncate text-[10px]" :title="tmpl.reality_public_key">{{ tmpl.reality_public_key || '系统自动派发' }}</span>
                  <button
                    v-if="tmpl.reality_public_key"
                    type="button"
                    @click="copyText(tmpl.reality_public_key)"
                    class="text-slate-400 hover:text-emerald-400 transition shrink-0"
                    title="复制公钥"
                  >
                    <Copy class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Details Block: Hysteria 2 -->
            <div v-else-if="tmpl.protocol === 'hysteria2'" class="space-y-2 pt-1 text-xs">
              <div class="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 font-mono">
                <div>
                  <span class="text-slate-500 text-[10px] block">服务器上行 (发送)</span>
                  <span class="text-sky-300 text-sm font-bold">{{ tmpl.hy2_up_mbps || 100 }} <span class="text-[10px] font-normal text-slate-400">Mbps</span></span>
                </div>
                <div>
                  <span class="text-slate-500 text-[10px] block">服务器下行 (接收)</span>
                  <span class="text-sky-300 text-sm font-bold">{{ tmpl.hy2_down_mbps || 100 }} <span class="text-[10px] font-normal text-slate-400">Mbps</span></span>
                </div>
              </div>

              <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1 font-mono text-[11px]">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-slate-500 text-[10px]">伪装回落网址:</span>
                  <span class="text-slate-300 truncate">{{ tmpl.hy2_masquerade || 'https://bing.com' }}</span>
                </div>
                <div class="text-[10px] text-slate-500">
                  自签 TLS 证书在主机运行时自动生成；UDP 拥塞控制支持。
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom Footer Note -->
          <div class="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
            <span>支持多主机单端口/跳跃端口复用</span>
            <span class="text-slate-400 font-mono">Slot Ready</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Create / Edit Template Modal -->
    <Teleport to="body">
      <div
        v-if="showModal"
        @click.self="showModal = false"
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto"
      >
        <div class="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-6 my-8">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-bold text-white flex items-center space-x-2">
                <span>{{ isEditing ? '编辑协议模板' : '新建协议模板' }}</span>
              </h2>
              <p class="text-xs text-slate-400 mt-0.5">
                {{ isEditing ? '更新模板参数，绑定该模板的主机在重连或心跳后生效' : '创建独立的单协议模板，之后可在主机中绑定为插槽' }}
              </p>
            </div>
            <button @click="showModal = false" class="text-slate-400 hover:text-white">
              <X class="w-5 h-5" />
            </button>
          </div>

          <form @submit.prevent="saveTemplate" class="space-y-4">
            <!-- 1. Name & Protocol -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  模板名称 <span class="text-rose-400">*</span>
                </label>
                <input
                  v-model="form.name"
                  type="text"
                  required
                  class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
                  placeholder="例如: 极速 VLESS / 100M-Hy2"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  协议类型 <span class="text-rose-400">*</span>
                </label>
                <select
                  v-model="form.protocol"
                  :disabled="isEditing"
                  class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="vless">VLESS + REALITY (TCP)</option>
                  <option value="hysteria2">Hysteria 2 (UDP)</option>
                </select>
              </div>
            </div>

            <!-- 2. VLESS REALITY Fields -->
            <div v-if="form.protocol === 'vless'" class="space-y-4 pt-1">
              <div class="flex items-center justify-between border-t border-slate-800 pt-3">
                <span class="text-xs font-semibold text-emerald-400 uppercase tracking-wider">REALITY 伪装目标配置</span>
                <button
                  type="button"
                  @click="openSniModal"
                  class="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium flex items-center space-x-1 transition"
                >
                  <Globe class="w-3.5 h-3.5" />
                  <span>选择推荐 SNI</span>
                </button>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-300 mb-1.5">伪装域名 (Server Name / SNI) *</label>
                  <input
                    v-model="form.reality_server_name"
                    type="text"
                    required
                    class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                    placeholder="例如: www.amazon.com"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-300 mb-1.5">回落目标 (Dest) *</label>
                  <input
                    v-model="form.reality_dest"
                    type="text"
                    required
                    class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                    placeholder="例如: www.amazon.com:443"
                  />
                </div>
              </div>

              <!-- Keys block -->
              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs">
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 font-semibold">X25519 密钥与 ShortID</span>
                  <button
                    type="button"
                    @click="generateKeys"
                    :disabled="generatingKeys"
                    class="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    {{ generatingKeys ? '生成中…' : '重新生成密钥对' }}
                  </button>
                </div>
                <div class="space-y-1 font-mono text-[11px]">
                  <div class="truncate text-slate-400">
                    <span class="text-slate-500">ShortID:</span> {{ form.reality_short_id || '(保存时自动生成)' }}
                  </div>
                  <div class="truncate text-slate-400">
                    <span class="text-slate-500">公钥:</span> {{ form.reality_public_key || '(保存时自动生成)' }}
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. Hysteria 2 Fields -->
            <div v-else-if="form.protocol === 'hysteria2'" class="space-y-4 pt-1">
              <div class="border-t border-slate-800 pt-3">
                <span class="text-xs font-semibold text-sky-400 uppercase tracking-wider">Hysteria 2 速率与伪装</span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-300 mb-1.5">服务器上行 (Mbps)</label>
                  <input
                    v-model.number="form.hy2_up_mbps"
                    type="number"
                    min="0"
                    step="1"
                    required
                    class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-sky-500 focus:outline-none"
                  />
                  <p class="text-[11px] text-slate-500 mt-1">对应客户端的下载方向，0 表示不限速</p>
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-300 mb-1.5">服务器下行 (Mbps)</label>
                  <input
                    v-model.number="form.hy2_down_mbps"
                    type="number"
                    min="0"
                    step="1"
                    required
                    class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-sky-500 focus:outline-none"
                  />
                  <p class="text-[11px] text-slate-500 mt-1">对应客户端的上传方向，0 表示不限速</p>
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-300 mb-1.5">HTTP 伪装网址</label>
                <input
                  v-model="form.hy2_masquerade"
                  type="text"
                  required
                  class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-sky-500 focus:outline-none"
                  placeholder="https://bing.com"
                />
                <p class="text-[11px] text-slate-500 mt-1">端口直接 HTTP 探测时伪装返回的目标网站</p>
              </div>
            </div>

            <!-- 4. Options -->
            <div class="pt-2 border-t border-slate-800 space-y-2">
              <label class="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" v-model="form.is_default" class="rounded bg-slate-950 border-slate-800 text-emerald-500 focus:ring-0 w-4 h-4" />
                <span>设为该协议的默认模板 (新建主机时自动绑定默认模板)</span>
              </label>

              <label v-if="isAdmin && !isEditing" class="flex items-center space-x-2 text-xs text-violet-300 cursor-pointer">
                <input type="checkbox" v-model="form.is_system" class="rounded bg-slate-950 border-slate-800 text-violet-500 focus:ring-0 w-4 h-4" />
                <span>设为系统公共模板 (全局可用，所有租户均可在其主机中挂载使用)</span>
              </label>
            </div>

            <!-- Error Feedback -->
            <p v-if="saveError" class="text-sm text-rose-300" role="alert">{{ saveError }}</p>

            <!-- Actions -->
            <div class="flex justify-end space-x-3 pt-3">
              <button
                type="button"
                @click="showModal = false"
                class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition"
              >
                取消
              </button>
              <button
                type="submit"
                :disabled="saving"
                class="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
              >
                {{ saving ? '正在保存…' : '保存模板' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- SNI Selection Modal -->
    <Teleport to="body">
      <div
        v-if="showSniModal"
        @click.self="showSniModal = false"
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
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
              :class="form.reality_server_name === preset.sni ? 'bg-emerald-500/10' : ''"
            >
              <div class="space-y-0.5">
                <div class="flex items-center space-x-2">
                  <span class="font-mono text-xs font-semibold text-white group-hover:text-emerald-300 transition">
                    {{ preset.sni }}
                  </span>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300">
                    {{ preset.label }}
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
                :class="form.reality_server_name === preset.sni
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'bg-slate-800 text-slate-300 hover:bg-emerald-500 hover:text-slate-950'"
              >
                <span>选用</span>
              </button>
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
import { Search, Globe, ShieldCheck, Zap, X, Plus, Trash2, Copy, Sliders } from 'lucide-vue-next'
import { request, getUser } from '../api'
import PageSkeleton from '../components/PageSkeleton.vue'
import { usePageRead } from '../composables/usePageRead'

const readPage = usePageRead()
const currentUser = getUser()
const isAdmin = computed(() => currentUser?.role === 'admin')

const templates = ref([])
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const saveError = ref('')
const generatingKeys = ref(false)

const activeFilter = ref('all')
const filterTabs = [
  { id: 'all', label: '全部' },
  { id: 'vless', label: 'VLESS Reality' },
  { id: 'hysteria2', label: 'Hysteria 2' },
  { id: 'system', label: '系统公共' },
  { id: 'private', label: '租户私有' }
]

const showModal = ref(false)
const isEditing = ref(false)
const editingId = ref(null)

const defaultForm = () => ({
  name: '',
  protocol: 'vless',
  reality_server_name: 'www.amazon.com',
  reality_dest: 'www.amazon.com:443',
  reality_private_key: '',
  reality_public_key: '',
  reality_short_id: '',
  hy2_up_mbps: 100,
  hy2_down_mbps: 100,
  hy2_masquerade: 'https://bing.com',
  is_default: false,
  is_system: false
})

const form = ref(defaultForm())

const showSniModal = ref(false)
const sniSearch = ref('')

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

const filteredTemplates = computed(() => {
  if (activeFilter.value === 'vless') return templates.value.filter(t => t.protocol === 'vless')
  if (activeFilter.value === 'hysteria2') return templates.value.filter(t => t.protocol === 'hysteria2')
  if (activeFilter.value === 'system') return templates.value.filter(t => t.owner_id === null)
  if (activeFilter.value === 'private') return templates.value.filter(t => t.owner_id !== null)
  return templates.value
})

function getFilteredCount(tabId) {
  if (tabId === 'vless') return templates.value.filter(t => t.protocol === 'vless').length
  if (tabId === 'hysteria2') return templates.value.filter(t => t.protocol === 'hysteria2').length
  if (tabId === 'system') return templates.value.filter(t => t.owner_id === null).length
  if (tabId === 'private') return templates.value.filter(t => t.owner_id !== null).length
  return templates.value.length
}

function canEdit(tmpl) {
  if (tmpl.owner_id === null) return isAdmin.value
  return isAdmin.value || tmpl.owner_id === currentUser?.id
}

async function loadTemplates() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await readPage('/api/v1/templates')
    templates.value = Array.isArray(data) ? data : []
  } catch (err) {
    loadError.value = err.message || '加载协议模板失败'
  } finally {
    loading.value = false
  }
}

async function generateKeys() {
  generatingKeys.value = true
  try {
    const res = await request('/api/v1/template/generate-keys')
    if (res) {
      form.value.reality_private_key = res.reality_private_key
      form.value.reality_public_key = res.reality_public_key
      form.value.reality_short_id = res.reality_short_id
    }
  } catch (err) {
    saveError.value = '生成密钥失败: ' + err.message
  } finally {
    generatingKeys.value = false
  }
}

function openCreateModal() {
  isEditing.value = false
  editingId.value = null
  form.value = defaultForm()
  saveError.value = ''
  generateKeys()
  showModal.value = true
}

function openEditModal(tmpl) {
  isEditing.value = true
  editingId.value = tmpl.id
  form.value = {
    name: tmpl.name,
    protocol: tmpl.protocol,
    reality_server_name: tmpl.reality_server_name || 'www.amazon.com',
    reality_dest: tmpl.reality_dest || 'www.amazon.com:443',
    reality_private_key: tmpl.reality_private_key || '',
    reality_public_key: tmpl.reality_public_key || '',
    reality_short_id: tmpl.reality_short_id || '',
    hy2_up_mbps: tmpl.hy2_up_mbps || 100,
    hy2_down_mbps: tmpl.hy2_down_mbps || 100,
    hy2_masquerade: tmpl.hy2_masquerade || 'https://bing.com',
    is_default: !!tmpl.is_default,
    is_system: tmpl.owner_id === null
  }
  saveError.value = ''
  showModal.value = true
}

async function saveTemplate() {
  saving.value = true
  saveError.value = ''
  try {
    const payload = {
      name: form.value.name.trim(),
      protocol: form.value.protocol,
      is_default: form.value.is_default ? 1 : 0,
      is_system: form.value.is_system
    }

    if (form.value.protocol === 'vless') {
      payload.reality_server_name = form.value.reality_server_name.trim()
      payload.reality_dest = form.value.reality_dest.trim()
      payload.reality_private_key = form.value.reality_private_key
      payload.reality_public_key = form.value.reality_public_key
      payload.reality_short_id = form.value.reality_short_id
    } else if (form.value.protocol === 'hysteria2') {
      payload.hy2_up_mbps = form.value.hy2_up_mbps
      payload.hy2_down_mbps = form.value.hy2_down_mbps
      payload.hy2_masquerade = form.value.hy2_masquerade.trim()
    }

    if (isEditing.value && editingId.value) {
      await request(`/api/v1/templates/${editingId.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      })
    } else {
      await request('/api/v1/templates', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
    }

    showModal.value = false
    await loadTemplates()
  } catch (err) {
    saveError.value = err.message || '保存模板失败'
  } finally {
    saving.value = false
  }
}

async function deleteTemplate(tmpl) {
  if (!confirm(`确定要删除协议模板 "${tmpl.name}" 吗？如果已有主机插槽绑定，需先解除绑定。`)) return
  try {
    await request(`/api/v1/templates/${tmpl.id}`, { method: 'DELETE' })
    await loadTemplates()
  } catch (err) {
    alert(err.message || '删除模板失败')
  }
}

function openSniModal() {
  sniSearch.value = ''
  showSniModal.value = true
}

function applyPresetAndClose(preset) {
  form.value.reality_server_name = preset.sni
  form.value.reality_dest = preset.dest
  showSniModal.value = false
}

function copyText(txt) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(txt)
  }
}

onMounted(() => {
  loadTemplates()
})
</script>
