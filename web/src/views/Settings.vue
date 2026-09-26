<template>
  <div class="p-8 space-y-8 max-w-2xl mx-auto">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-white">管理员设置 (Account)</h1>
      <p class="text-sm text-slate-400 mt-1">
        修改管理员登录用户名与访问密码。
      </p>
    </div>

    <!-- Admin Profile Form -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
      <PageSkeleton v-if="loadingProfile" label="正在加载管理员信息…" />
      <div v-else-if="profileLoadError" role="alert" class="text-sm text-rose-300">
        {{ profileLoadError }}
        <button type="button" @click="loadProfile" class="ml-2 underline">重新加载</button>
      </div>
      <form v-else @submit.prevent="saveAdminProfile" class="space-y-6">
        <div>
          <h2 class="text-base font-semibold text-white mb-4 flex items-center space-x-2">
            <span class="w-2 h-2 rounded-full bg-blue-500"></span>
            <span>管理员账号与密码修改</span>
          </h2>

          <div class="space-y-4">
            <div>
              <label for="admin-username" class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                管理员用户名 <span class="text-rose-400">*</span>
              </label>
              <input
                id="admin-username"
                v-model="profileForm.username"
                type="text"
                required
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="输入管理员用户名"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                原密码 <span class="text-slate-500 font-normal">(仅在修改密码时必填)</span>
              </label>
              <input
                v-model="profileForm.old_password"
                type="password"
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="输入当前使用的管理密码"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                新密码 <span class="text-slate-500 font-normal">(留空表示不修改密码)</span>
              </label>
              <input
                v-model="profileForm.new_password"
                type="password"
                minlength="6"
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="不少于 6 位"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                确认新密码
              </label>
              <input
                v-model="profileForm.confirm_password"
                type="password"
                minlength="6"
                class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="重复输入新密码"
              />
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-slate-800">
          <p class="text-xs text-slate-500">保存后将重新登录，代理密码不受影响</p>
          <button
            type="submit"
            :disabled="savingProfile"
            class="px-5 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition disabled:opacity-50 shadow-lg shadow-blue-500/20"
          >
            <span v-if="savingProfile">正在保存...</span>
            <span v-else>更新管理员信息</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { request, removeToken } from '../api'
import { useRouter } from 'vue-router'
import PageSkeleton from '../components/PageSkeleton.vue'
import { usePageRead } from '../composables/usePageRead'
const router = useRouter()
const readPage = usePageRead()

const profileForm = ref({
  username: '',
  old_password: '',
  new_password: '',
  confirm_password: ''
})
const savingProfile = ref(false)
const loadingProfile = ref(true)
const profileLoadError = ref('')

async function loadProfile() {
  loadingProfile.value = true
  profileLoadError.value = ''
  try {
    const profile = await readPage('/api/v1/system/profile')
    if (!profile || typeof profile.username !== 'string' || !profile.username.trim()) {
      throw new Error('管理员信息响应无效，请重新加载')
    }
    profileForm.value.username = profile.username
  } catch (err) {
    if (err.name === 'AbortError') return
    profileLoadError.value = err.message || '加载管理员信息失败'
  } finally {
    loadingProfile.value = false
  }
}

async function saveAdminProfile() {
  if (loadingProfile.value || profileLoadError.value || savingProfile.value) return
  if (profileForm.value.new_password) {
    if (profileForm.value.new_password.length < 6) {
      alert('新密码长度不能少于 6 位')
      return
    }
    if (profileForm.value.new_password !== profileForm.value.confirm_password) {
      alert('两次输入的新密码不一致')
      return
    }
    if (!profileForm.value.old_password) {
      alert('修改密码时必须输入当前原密码')
      return
    }
  }

  savingProfile.value = true
  try {
    await request('/api/v1/system/profile', {
      method: 'POST',
      body: JSON.stringify(profileForm.value)
    })
    profileForm.value.old_password = ''
    profileForm.value.new_password = ''
    profileForm.value.confirm_password = ''
    alert('管理员信息已更新，请重新登录。')
    removeToken()
    router.push('/login')
  } catch (err) {
    alert(err.message || '更新管理员信息失败')
  } finally {
    savingProfile.value = false
  }
}

onMounted(() => {
  loadProfile()
})
</script>
