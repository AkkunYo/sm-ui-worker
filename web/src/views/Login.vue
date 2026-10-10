<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-slate-950">
    <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      <div class="text-center mb-8">
        <div class="inline-flex w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 items-center justify-center text-emerald-400 font-bold text-xl mb-3">
          SM
        </div>
        <h2 class="text-2xl font-bold text-white tracking-tight">SM-UI 登录</h2>
        <p class="text-sm text-slate-400 mt-1">SingBox-Matrix-UI 集群控制中心</p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">用户名</label>
          <input
            v-model="form.username"
            type="text"
            required
            class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition text-sm"
            placeholder="默认: admin"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">密码</label>
          <input
            v-model="form.password"
            type="password"
            required
            class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition text-sm"
            placeholder="输入管理密码"
          />
        </div>

        <div v-if="error" class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          {{ error }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold transition text-sm flex items-center justify-center disabled:opacity-50"
        >
          <span v-if="loading">登录中...</span>
          <span v-else>立即登录</span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { request, setToken, setUser } from '../api'

const router = useRouter()
const form = reactive({
  username: '',
  password: ''
})
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  loading.value = true
  error.value = ''
  try {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(form)
    })
    if (res && res.user) {
      setToken('cookie')
      if (res.user) setUser(res.user)
      router.push('/')
    }
  } catch (err) {
    error.value = err.message || '用户名或密码错误'
  } finally {
    loading.value = false
  }
}
</script>
