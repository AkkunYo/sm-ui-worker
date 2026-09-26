<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-slate-950">
    <div class="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-10 shadow-2xl relative overflow-hidden">
      <!-- Background Ambient Glow -->
      <div class="absolute -top-24 -right-24 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div class="text-center mb-8">
        <div class="inline-flex w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 items-center justify-center text-emerald-400 font-bold text-2xl mb-4 shadow-lg shadow-emerald-500/10">
          SM
        </div>
        <h2 class="text-2xl font-bold text-white tracking-tight">SM-UI 初始引导设置</h2>
        <p class="text-sm text-slate-400 mt-1">首次运行配置，完成后将自动进入控制台且不再展示本页</p>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            管理员用户名 <span class="text-rose-400">*</span>
          </label>
          <input
            v-model="form.username"
            type="text"
            required
            class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition text-sm"
            placeholder="admin"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            管理密码 <span class="text-rose-400">* (不少于 6 位)</span>
          </label>
          <input
            v-model="form.password"
            type="password"
            required
            minlength="6"
            class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition text-sm"
            placeholder="请输入管理员密码"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            确认密码 <span class="text-rose-400">*</span>
          </label>
          <input
            v-model="form.confirm_password"
            type="password"
            required
            minlength="6"
            class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition text-sm"
            placeholder="请再次输入以确认"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            主控主机名 <span class="text-rose-400">* (默认 Master)</span>
          </label>
          <input
            v-model="form.master_name"
            type="text"
            required
            class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition text-sm"
            placeholder="Master"
          />
          <p class="text-[11px] text-slate-500 mt-1">在主机列表与订阅中显示为该节点名称（如: <code class="text-emerald-400 font-mono">{{ form.master_name || 'Master' }}-IP</code>）</p>
        </div>

        <div v-if="error" class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          {{ error }}
        </div>

        <div class="pt-3">
          <button
            type="submit"
            :disabled="loading"
            class="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold transition text-sm flex items-center justify-center disabled:opacity-50 shadow-lg shadow-emerald-500/20"
          >
            <span v-if="loading">正在完成初始化...</span>
            <span v-else>完成设置并进入系统</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { request, setToken, setUser } from '../api'
import { setSystemInitialized } from '../router'

const router = useRouter()
const loading = ref(false)
const error = ref('')

const form = reactive({
  username: 'admin',
  password: '',
  confirm_password: '',
  master_name: 'Master'
})

async function handleSubmit() {
  error.value = ''
  if (!form.username.trim()) {
    error.value = '请输入管理员用户名'
    return
  }
  if (!form.password || form.password.length < 6) {
    error.value = '管理密码不能少于 6 位'
    return
  }
  if (form.password !== form.confirm_password) {
    error.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  try {
    const res = await request('/api/v1/system/setup', {
      method: 'POST',
      body: JSON.stringify(form)
    })
    if (res && res.token) {
      setSystemInitialized(true)
      setToken(res.token)
      if (res.user) setUser(res.user)
      window.location.hash = '#/'
    }
  } catch (err) {
    error.value = err.message || '初始化引导提交失败'
  } finally {
    loading.value = false
  }
}
</script>
