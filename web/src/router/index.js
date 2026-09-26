import { createRouter, createWebHashHistory } from 'vue-router'
import { ref } from 'vue'
import { getToken, request } from '../api'

import Dashboard from '../views/Dashboard.vue'
import Inbounds from '../views/Inbounds.vue'
import Nodes from '../views/Nodes.vue'
import Subscription from '../views/Subscription.vue'
import Settings from '../views/Settings.vue'
import Login from '../views/Login.vue'
import Setup from '../views/Setup.vue'

const routes = [
  { path: '/setup', component: Setup, meta: { public: true } },
  { path: '/login', component: Login, meta: { public: true } },
  { path: '/', component: Dashboard },
  { path: '/inbounds', component: Inbounds },
  { path: '/nodes', component: Nodes },
  { path: '/subscription', component: Subscription },
  { path: '/users', redirect: '/subscription' },
  { path: '/settings', component: Settings },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// This is application bootstrap state, not a per-navigation network dependency.
export let isSystemInitialized = null
export const initializing = ref(true)
export const initializationError = ref('')
export const appVersion = ref('')
let initializationRequest = null
let initialPath = '/'

export function setSystemInitialized(val) {
  isSystemInitialized = val
}

export function retryInitialization() {
  return router.replace(initialPath)
}

function initializeSystem() {
  if (initializationRequest) return initializationRequest
  initializing.value = true
  initializationError.value = ''
  initializationRequest = request('/api/v1/system/setup/status')
    .then(res => {
      if (typeof res?.is_initialized !== 'boolean') throw new Error('初始化状态响应无效，请重试')
      appVersion.value = typeof res.version === 'string' ? res.version.replace(/^v/, '') : ''
      setSystemInitialized(res.is_initialized)
    })
    .catch(err => {
      initializationError.value = err.message || '无法连接主控，请重试'
      throw err
    })
    .finally(() => {
      initializing.value = false
      initializationRequest = null
    })
  return initializationRequest
}

router.beforeEach(async (to, from, next) => {
  if (isSystemInitialized === null) {
    initialPath = to.fullPath
    try {
      await initializeSystem()
    } catch {
      return next(false)
    }
  }

  // If not initialized, force redirect to /setup
  if (!isSystemInitialized) {
    if (to.path !== '/setup') {
      return next('/setup')
    }
    return next()
  }

  // If initialized and trying to visit /setup, redirect to login or dashboard
  if (to.path === '/setup') {
    const token = getToken()
    if (token) {
      return next('/')
    }
    return next('/login')
  }

  const token = getToken()
  if (!to.meta.public && !token) {
    next('/login')
  } else if (to.path === '/login' && token) {
    next('/')
  } else {
    next()
  }
})

export default router
