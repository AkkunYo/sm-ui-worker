<template>
  <div v-if="initializing || initializationError" class="max-w-2xl mx-auto p-4 sm:p-8 space-y-6">
    <h1 class="text-xl font-semibold text-white">SM-UI</h1>
    <PageSkeleton v-if="initializing" label="正在连接主控…" />
    <div v-else role="alert" class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-300">
      {{ initializationError }}
      <button type="button" @click="retryInitialization" class="ml-3 underline">重试</button>
    </div>
  </div>
  <div v-else class="min-h-screen flex bg-slate-950 text-slate-100">
    <!-- Sidebar (hidden on login page) -->
    <aside v-if="!isLoginPage" class="hidden md:flex w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 flex-col backdrop-blur">
      <div class="p-6 border-b border-slate-800 flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
            SM
          </div>
          <div>
            <h1 class="font-bold tracking-tight text-white">SM-UI</h1>
            <p class="text-xs text-slate-400">SingBox Matrix UI</p>
          </div>
        </div>
      </div>

      <nav class="flex-1 p-4 space-y-1.5">
        <router-link
          to="/"
          class="flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition"
          :class="$route.path === '/' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <LayoutDashboard class="w-4 h-4" />
          <span>仪表盘 (Dashboard)</span>
        </router-link>

        <router-link
          to="/inbounds"
          class="flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition"
          :class="$route.path === '/inbounds' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <Sliders class="w-4 h-4" />
          <span>协议模板 (Inbound)</span>
        </router-link>

        <router-link
          to="/nodes"
          class="flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition"
          :class="$route.path === '/nodes' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <Server class="w-4 h-4" />
          <span>节点主机 (Hosts)</span>
        </router-link>

        <router-link
          to="/subscription"
          class="flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition"
          :class="$route.path === '/subscription' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <Link2 class="w-4 h-4" />
          <span>订阅链接 (Subscription)</span>
        </router-link>

        <router-link
          v-if="currentUser?.role === 'admin'"
          to="/users"
          class="flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition"
          :class="$route.path === '/users' ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <UsersIcon class="w-4 h-4" />
          <span>租户管理 (Tenants)</span>
        </router-link>

        <router-link
          to="/settings"
          class="flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition"
          :class="$route.path === '/settings' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <SettingsIcon class="w-4 h-4" />
          <span>账号设置 (Account)</span>
        </router-link>
      </nav>

      <div class="p-4 border-t border-slate-800 space-y-3">
        <div v-if="currentUser" class="flex items-center justify-between px-2 py-1.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div class="flex items-center space-x-2 truncate">
            <span class="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center uppercase shrink-0">
              {{ currentUser.username ? currentUser.username[0] : 'U' }}
            </span>
            <span class="text-xs font-semibold text-slate-200 truncate">{{ currentUser.username }}</span>
          </div>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium shrink-0" :class="currentUser.role === 'admin' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'">
            {{ currentUser.role === 'admin' ? '超管' : '租户' }}
          </span>
        </div>
        <p class="px-3.5 text-xs text-slate-500 font-mono" data-testid="app-version">SM-UI {{ appVersion ? `v${appVersion}` : '—' }}</p>
        <button
          @click="logout"
          class="w-full flex items-center space-x-3 px-3.5 py-2 rounded-lg text-sm text-rose-400 hover:bg-rose-500/10 transition"
        >
          <LogOut class="w-4 h-4" />
          <span>退出登录</span>
        </button>
      </div>
    </aside>

    <nav v-if="!isLoginPage" aria-label="移动导航" class="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 border-t border-slate-800 flex justify-around p-3 backdrop-blur">
      <router-link v-for="item in mobileNav" :key="item.path" :to="item.path" class="flex flex-col items-center gap-1 text-[10px]" :class="$route.path === item.path ? 'text-violet-300' : 'text-slate-400'"><component :is="item.icon" class="w-5 h-5" />{{ item.label }}</router-link>
      <button class="flex flex-col items-center gap-1 text-[10px] text-rose-400" @click="logout"><LogOut class="w-5 h-5" />退出</button>
    </nav>
    <!-- Main Content -->
    <main class="flex-1 min-w-0 overflow-y-auto" :class="!isLoginPage ? 'pb-20 md:pb-0' : ''">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutDashboard, Server, Link2, Sliders, Users as UsersIcon, Settings as SettingsIcon, LogOut } from 'lucide-vue-next'
import { removeToken, getUser } from './api'
import { initializing, initializationError, retryInitialization, appVersion } from './router'
import PageSkeleton from './components/PageSkeleton.vue'

const currentUser = computed(() => getUser())

const mobileNav = computed(() => {
  const items = [
    { path: '/', label: '概览', icon: LayoutDashboard },
    { path: '/nodes', label: '节点', icon: Server },
    { path: '/subscription', label: '订阅', icon: Link2 },
    { path: '/inbounds', label: '协议', icon: Sliders }
  ]
  if (currentUser.value?.role === 'admin') {
    items.push({ path: '/users', label: '租户', icon: UsersIcon })
  }
  items.push({ path: '/settings', label: '账号', icon: SettingsIcon })
  return items
})
const route = useRoute()
const router = useRouter()

const isLoginPage = computed(() => route.path === '/login' || route.path === '/setup')

function logout() {
  removeToken()
  router.push('/login')
}
</script>
