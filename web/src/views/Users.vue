<template>
  <div class="p-4 sm:p-8 space-y-8 max-w-7xl mx-auto">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-white">租户用户管理 (Tenants)</h1>
        <p class="text-sm text-slate-400 mt-1">管理多租户独立空间，各租户拥有专属 VPS 主机池与完全隔离的节点订阅</p>
      </div>
      <button
        @click="openAddModal"
        class="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-semibold text-sm transition flex items-center space-x-2 shadow-lg shadow-violet-500/20"
      >
        <UserPlus class="w-4 h-4" />
        <span>添加租户用户</span>
      </button>
    </div>

    <div v-if="error" role="alert" class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 flex items-center justify-between">
      <span>{{ error }}</span>
      <button type="button" @click="loadUsers" class="underline">重试</button>
    </div>

    <!-- Users Table -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm text-slate-300">
          <thead class="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th class="px-5 py-3.5 font-semibold">租户名称</th>
              <th class="px-5 py-3.5 font-semibold">系统权限</th>
              <th class="px-5 py-3.5 font-semibold">状态</th>
              <th class="px-5 py-3.5 font-semibold">独占主机数</th>
              <th class="px-5 py-3.5 font-semibold">流量统计 / 配额</th>
              <th class="px-5 py-3.5 font-semibold">有效期</th>
              <th class="px-5 py-3.5 font-semibold">专属订阅</th>
              <th class="px-5 py-3.5 font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
            <tr v-if="loading && users.length === 0">
              <td colspan="8" class="px-6 py-12 text-center text-slate-500">正在加载租户列表…</td>
            </tr>
            <tr v-else-if="users.length === 0">
              <td colspan="8" class="px-6 py-12 text-center text-slate-500">暂无租户用户，点击右上角添加新租户。</td>
            </tr>
            <tr v-for="user in users" :key="user.id" class="hover:bg-slate-800/30 transition">
              <td class="px-5 py-4 font-semibold text-white">
                <div class="flex items-center space-x-2">
                  <span class="w-7 h-7 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/20 flex items-center justify-center text-xs font-bold uppercase">
                    {{ user.username.substring(0, 1) }}
                  </span>
                  <span>{{ user.username }}</span>
                </div>
              </td>
              <td class="px-5 py-4">
                <span
                  class="px-2 py-0.5 rounded text-[11px] font-medium"
                  :class="user.role === 'admin' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'"
                >
                  {{ user.role === 'admin' ? '超级管理员' : '普通租户' }}
                </span>
              </td>
              <td class="px-5 py-4">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium"
                  :class="user.status === 1 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'"
                >
                  <span class="w-1.5 h-1.5 rounded-full mr-1.5" :class="user.status === 1 ? 'bg-emerald-400' : 'bg-rose-400'"></span>
                  {{ user.status === 1 ? '正常' : '已停用' }}
                </span>
              </td>
              <td class="px-5 py-4">
                <span class="font-mono text-slate-200">{{ user.node_count || 0 }} 台</span>
              </td>
              <td class="px-5 py-4">
                <div class="text-xs">
                  <span class="text-slate-200">{{ formatBytes((user.used_up_bytes || 0) + (user.used_down_bytes || 0)) }}</span>
                  <span class="text-slate-500"> / </span>
                  <span class="text-slate-400">{{ user.traffic_limit_bytes ? formatBytes(user.traffic_limit_bytes) : '无限制' }}</span>
                </div>
              </td>
              <td class="px-5 py-4 text-xs text-slate-400">
                {{ user.expire_at ? new Date(user.expire_at).toLocaleDateString() : '永久有效' }}
              </td>
              <td class="px-5 py-4">
                <button
                  @click="copySubUrl(user)"
                  class="p-1.5 text-slate-400 hover:text-violet-300 hover:bg-violet-500/10 rounded-lg transition flex items-center space-x-1 text-xs"
                  title="复制该租户专属订阅地址"
                >
                  <Link2 class="w-3.5 h-3.5" />
                  <span>复制订阅</span>
                </button>
              </td>
              <td class="px-5 py-4 text-right">
                <div class="flex items-center justify-end space-x-2">
                  <button
                    @click="openEditModal(user)"
                    class="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                    title="编辑租户信息"
                  >
                    <Edit3 class="w-3.5 h-3.5" />
                  </button>
                  <button
                    v-if="user.id !== 1"
                    @click="deleteUser(user)"
                    class="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                    title="删除租户"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add User Modal -->
    <Teleport to="body">
      <div v-if="addModalOpen" class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-bold text-white">添加租户用户</h3>
            <button @click="addModalOpen = false" class="text-slate-400 hover:text-white"><X class="w-5 h-5" /></button>
          </div>

          <form @submit.prevent="submitAddUser" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">租户登录用户名 <span class="text-rose-400">*</span></label>
              <input v-model="addForm.username" type="text" required placeholder="如: zkyml, yjwenhua" class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-violet-500" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">登录密码 <span class="text-rose-400">* (不少于 6 位)</span></label>
              <input v-model="addForm.password" type="password" required minlength="6" placeholder="用于登录控制台" class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-violet-500" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">总流量限制 (GB)</label>
              <input v-model.number="addForm.limit_gb" type="number" min="0" step="0.1" placeholder="0 代表无限制" class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-violet-500" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">到期时间 (留空为永久有效)</label>
              <input v-model="addForm.expire_at" type="datetime-local" class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-violet-500" />
            </div>

            <div v-if="modalError" class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {{ modalError }}
            </div>

            <div class="pt-2 flex justify-end space-x-3">
              <button type="button" @click="addModalOpen = false" class="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm">取消</button>
              <button type="submit" :disabled="submitting" class="px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-semibold text-sm transition disabled:opacity-50">
                {{ submitting ? '创建中…' : '立即创建' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Edit User Modal -->
      <div v-if="editModalOpen" class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-bold text-white">编辑租户：{{ editForm.username }}</h3>
            <button @click="editModalOpen = false" class="text-slate-400 hover:text-white"><X class="w-5 h-5" /></button>
          </div>

          <form @submit.prevent="submitEditUser" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">重置登录密码 (留空则保持不变)</label>
              <input v-model="editForm.password" type="password" minlength="6" placeholder="留空不修改" class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-violet-500" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">总流量限制 (GB)</label>
              <input v-model.number="editForm.limit_gb" type="number" min="0" step="0.1" class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-violet-500" />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">到期时间 (留空为永久)</label>
              <input v-model="editForm.expire_at" type="datetime-local" class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-violet-500" />
            </div>

            <div>
              <label class="flex items-center space-x-2 text-sm text-slate-300">
                <input v-model="editForm.enabled" type="checkbox" class="rounded bg-slate-950 border-slate-800 text-violet-500 focus:ring-0" />
                <span>账号启用状态</span>
              </label>
            </div>

            <div v-if="modalError" class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {{ modalError }}
            </div>

            <div class="pt-2 flex justify-between items-center">
              <button type="button" @click="resetUserSubToken" class="text-xs text-rose-400 hover:underline">重置订阅地址</button>
              <div class="flex space-x-3">
                <button type="button" @click="editModalOpen = false" class="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm">取消</button>
                <button type="submit" :disabled="submitting" class="px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-semibold text-sm transition disabled:opacity-50">
                  {{ submitting ? '保存中…' : '保存更新' }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { UserPlus, Link2, Edit3, Trash2, X } from 'lucide-vue-next'
import { request, formatBytes } from '../api'

const users = ref([])
const loading = ref(false)
const error = ref('')
const submitting = ref(false)
const modalError = ref('')

const addModalOpen = ref(false)
const addForm = reactive({
  username: '',
  password: '',
  limit_gb: 0,
  expire_at: ''
})

const editModalOpen = ref(false)
const editForm = reactive({
  id: null,
  username: '',
  password: '',
  limit_gb: 0,
  expire_at: '',
  enabled: true
})

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const data = await request('/api/v1/users')
    if (Array.isArray(data)) {
      users.value = data
    }
  } catch (err) {
    error.value = err.message || '加载租户列表失败'
  } finally {
    loading.value = false
  }
}

function openAddModal() {
  addForm.username = ''
  addForm.password = ''
  addForm.limit_gb = 0
  addForm.expire_at = ''
  modalError.value = ''
  addModalOpen.value = true
}

async function submitAddUser() {
  submitting.value = true
  modalError.value = ''
  try {
    const payload = {
      username: addForm.username.trim(),
      password: addForm.password,
      traffic_limit_bytes: Math.round((addForm.limit_gb || 0) * 1073741824),
      expire_at: addForm.expire_at ? new Date(addForm.expire_at).toISOString() : null
    }
    await request('/api/v1/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    addModalOpen.value = false
    await loadUsers()
  } catch (err) {
    modalError.value = err.message || '创建租户失败'
  } finally {
    submitting.value = false
  }
}

function openEditModal(user) {
  editForm.id = user.id
  editForm.username = user.username
  editForm.password = ''
  editForm.limit_gb = user.traffic_limit_bytes ? Number((user.traffic_limit_bytes / 1073741824).toFixed(2)) : 0
  editForm.expire_at = user.expire_at ? new Date(new Date(user.expire_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
  editForm.enabled = user.status === 1
  modalError.value = ''
  editModalOpen.value = true
}

async function submitEditUser() {
  submitting.value = true
  modalError.value = ''
  try {
    const payload = {
      status: editForm.enabled ? 1 : 0,
      traffic_limit_bytes: Math.round((editForm.limit_gb || 0) * 1073741824),
      clear_expiry: !editForm.expire_at,
      expire_at: editForm.expire_at ? new Date(editForm.expire_at).toISOString() : null
    }
    if (editForm.password) {
      payload.password = editForm.password
    }
    await request(`/api/v1/users/${editForm.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    })
    editModalOpen.value = false
    await loadUsers()
  } catch (err) {
    modalError.value = err.message || '更新租户失败'
  } finally {
    submitting.value = false
  }
}

async function resetUserSubToken() {
  if (!confirm(`确定重置租户 ${editForm.username} 的订阅地址？旧地址将立即失效。`)) return
  try {
    await request(`/api/v1/users/${editForm.id}`, {
      method: 'PUT',
      body: JSON.stringify({ reset_subscription: true })
    })
    editModalOpen.value = false
    await loadUsers()
    alert('订阅地址已成功重置')
  } catch (err) {
    modalError.value = err.message || '重置失败'
  }
}

async function deleteUser(user) {
  if (!confirm(`确定删除租户 ${user.username} 及其名下所有接入主机？此操作不可撤销。`)) return
  try {
    await request(`/api/v1/users/${user.id}`, { method: 'DELETE' })
    await loadUsers()
  } catch (err) {
    alert(err.message || '删除租户失败')
  }
}

function copySubUrl(user) {
  const url = `${window.location.origin}/sub/${encodeURIComponent(user.username)}/${encodeURIComponent(user.sub_token)}`
  navigator.clipboard.writeText(url).then(() => {
    alert(`租户 ${user.username} 的专属订阅链接已复制到剪贴板`)
  }).catch(() => {
    prompt('请手动复制订阅链接：', url)
  })
}

onMounted(() => {
  loadUsers()
})
</script>
