<template>
  <div v-if="initializing || initializationError" class="max-w-2xl mx-auto p-4 sm:p-8 space-y-6">
    <h1 class="text-xl font-semibold text-white">SM-UI</h1>
    <PageSkeleton v-if="initializing" label="正在连接主控…" />
    <div v-else role="alert" class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-300">
      {{ initializationError }}
      <button type="button" @click="retryInitialization" class="ml-3 underline">重试</button>
    </div>
  </div>
  <div v-else class="h-screen w-screen flex bg-slate-950 text-slate-100 overflow-hidden">
    <!-- Desktop Sidebar (Fixed Full Height & Collapsible) -->
    <aside
      v-if="!isLoginPage"
      class="hidden md:flex h-screen shrink-0 border-r border-slate-800 bg-slate-900/90 flex-col justify-between backdrop-blur transition-all duration-300 ease-in-out select-none"
      :class="isCollapsed ? 'w-20' : 'w-64'"
    >
      <!-- Top Header & Collapse Toggle -->
      <div>
        <div class="p-4 border-b border-slate-800 flex items-center" :class="isCollapsed ? 'flex-col space-y-3 justify-center' : 'justify-between'">
          <div class="flex items-center space-x-3 truncate">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold shrink-0">
              SM
            </div>
            <div v-if="!isCollapsed" class="truncate">
              <h1 class="font-bold tracking-tight text-white leading-tight">SM-UI</h1>
              <p class="text-[11px] text-slate-400 truncate">SingBox Matrix UI</p>
            </div>
          </div>

          <button
            type="button"
            @click="toggleSidebar"
            :title="isCollapsed ? '展开导航栏' : '收起导航栏'"
            class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
          >
            <ChevronRight v-if="isCollapsed" class="w-4 h-4" />
            <ChevronLeft v-else class="w-4 h-4" />
          </button>
        </div>

        <!-- Navigation Links -->
        <nav class="p-3 space-y-1.5">
          <router-link
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            :title="isCollapsed ? item.label : undefined"
            class="flex items-center rounded-xl text-sm font-medium transition group"
            :class="[
              isCollapsed ? 'justify-center p-3' : 'space-x-3 px-3.5 py-2.5',
              $route.path === item.path
                ? (item.highlight ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20')
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            ]"
          >
            <component :is="item.icon" class="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" />
            <span v-if="!isCollapsed" class="truncate">{{ item.label }}</span>
          </router-link>
        </nav>
      </div>

      <!-- Bottom User Profile & Logout -->
      <div class="p-3 border-t border-slate-800 space-y-2">
        <!-- User Badge -->
        <div
          v-if="currentUser"
          class="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2"
          :class="isCollapsed ? 'flex justify-center' : 'flex items-center justify-between space-x-2'"
          :title="`${currentUser.username} (${currentUser.role === 'admin' ? '超级管理员' : '普通租户'})`"
        >
          <div class="flex items-center space-x-2 truncate">
            <span
              class="w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center uppercase shrink-0"
              :class="currentUser.role === 'admin' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'"
            >
              {{ (currentUser.username || 'U')[0] }}
            </span>
            <span v-if="!isCollapsed" class="text-xs font-semibold text-slate-200 truncate">{{ currentUser.username }}</span>
          </div>
          <span
            v-if="!isCollapsed"
            class="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
            :class="currentUser.role === 'admin' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'"
          >
            {{ currentUser.role === 'admin' ? '超管' : '租户' }}
          </span>
        </div>

        <div v-if="!isCollapsed" class="px-2 flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span>Version</span>
          <span>{{ appVersion ? `v${appVersion}` : 'v1.1.0' }}</span>
        </div>

        <!-- Logout Button -->
        <button
          @click="logout"
          :title="isCollapsed ? '退出登录' : undefined"
          class="w-full flex items-center rounded-xl text-sm text-rose-400 hover:bg-rose-500/10 transition"
          :class="isCollapsed ? 'justify-center p-3' : 'space-x-3 px-3.5 py-2'"
        >
          <LogOut class="w-4 h-4 shrink-0" />
          <span v-if="!isCollapsed">退出登录</span>
        </button>
      </div>
    </aside>

    <!-- Mobile Nav Bar (Bottom) -->
    <nav v-if="!isLoginPage" aria-label="移动导航" class="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 border-t border-slate-800 flex justify-around p-3 backdrop-blur">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="flex flex-col items-center gap-1 text-[10px]"
        :class="$route.path === item.path ? 'text-emerald-400' : 'text-slate-400'"
      >
        <component :is="item.icon" class="w-5 h-5" />
        {{ item.shortLabel }}
      </router-link>
      <button class="flex flex-col items-center gap-1 text-[10px] text-rose-400" @click="logout">
        <LogOut class="w-5 h-5" />
        退出
      </button>
    </nav>

    <!-- Main Content (Full Height, Independent Scroll) -->
    <main class="flex-1 min-w-0 h-screen overflow-y-auto" :class="!isLoginPage ? 'pb-20 md:pb-0' : ''">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Server,
  Link2,
  Sliders,
  Users as UsersIcon,
  Settings as SettingsIcon,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-vue-next'
import { removeToken, getUser, setUser, getToken, request } from './api'
import { initializing, initializationError, retryInitialization, appVersion } from './router'
import PageSkeleton from './components/PageSkeleton.vue'

const route = useRoute()
const router = useRouter()

const isCollapsed = ref(localStorage.getItem('sm_sidebar_collapsed') === 'true')
const currentUser = ref(getUser())

function toggleSidebar() {
  isCollapsed.value = !isCollapsed.value
  localStorage.setItem('sm_sidebar_collapsed', isCollapsed.value.toString())
}

const navItems = computed(() => {
  const items = [
    { path: '/', label: '仪表盘 (Dashboard)', shortLabel: '概览', icon: LayoutDashboard },
    { path: '/nodes', label: '节点主机 (Hosts)', shortLabel: '主机', icon: Server },
    { path: '/inbounds', label: '协议模板 (Inbound)', shortLabel: '协议', icon: Sliders },
    { path: '/subscription', label: '订阅链接 (Subscription)', shortLabel: '订阅', icon: Link2 }
  ]
  // Always visible if admin, or if user data has role: 'admin'
  if (currentUser.value?.role === 'admin') {
    items.push({
      path: '/users',
      label: '租户管理 (Tenants)',
      shortLabel: '租户',
      icon: UsersIcon,
      highlight: true
    })
  }
  items.push({ path: '/settings', label: '账号设置 (Account)', shortLabel: '账号', icon: SettingsIcon })
  return items
})

const isLoginPage = computed(() => route.path === '/login' || route.path === '/setup')

async function syncProfile() {
  const token = getToken()
  if (!token || isLoginPage.value) return
  try {
    const profile = await request('/api/v1/system/profile')
    if (profile && profile.username) {
      currentUser.value = profile
      localStorage.setItem('sm_ui_user', JSON.stringify(profile))
    }
  } catch (err) {}
}

function handleAuthChanged() {
  currentUser.value = getUser()
}

onMounted(() => {
  syncProfile()
  window.addEventListener('auth-changed', handleAuthChanged)
})

onUnmounted(() => {
  window.removeEventListener('auth-changed', handleAuthChanged)
})

watch(() => route.path, () => {
  if (!isLoginPage.value && (!currentUser.value || !currentUser.value.role)) {
    syncProfile()
  }
})

function logout() {
  removeToken()
  currentUser.value = null
  router.push('/login')
}
</script>
