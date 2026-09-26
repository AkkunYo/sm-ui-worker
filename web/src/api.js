const TOKEN_KEY = 'sm_ui_token'
const USER_KEY = 'sm_ui_user'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth-changed'))
  }
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

export function setUser(user) {
  const old = localStorage.getItem(USER_KEY)
  const next = user ? JSON.stringify(user) : null
  if (old === next) return
  if (next) {
    localStorage.setItem(USER_KEY, next)
  } else {
    localStorage.removeItem(USER_KEY)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth-changed'))
  }
}

export async function request(path, options = {}) {
  const { timeoutMs = 10000, signal, ...fetchOptions } = options
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const res = await fetch(path, {
      ...fetchOptions,
      headers,
      signal: controller.signal
    })

    if (res.status === 401) {
      // A response from an old session must not log out a newly signed-in user.
      if (getToken() === token) {
        removeToken()
        if (window.location.hash !== '#/login') window.location.hash = '#/login'
      }
      throw new Error('登录已失效，请重新登录')
    }

    // Keep the deadline active until the response body has also arrived.
    const body = await res.text()
    let data = null
    try { data = JSON.parse(body) } catch { /* Empty/non-JSON response. */ }
    if (!res.ok) throw new Error(data?.error || res.statusText || `HTTP ${res.status}`)
    return data
  } catch (err) {
    if (timedOut) {
      const reading = !fetchOptions.method || ['GET', 'HEAD'].includes(fetchOptions.method.toUpperCase())
      const error = new Error(reading ? '请求超时，请重试' : '请求超时，操作可能已提交，请刷新确认结果后再操作')
      error.name = 'TimeoutError'
      throw error
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
