import { test, expect } from '@playwright/test'

const nodes = [{ id: 1, name: 'Master Demo', status: 'online', core_state: 'running', config_status: 'applied', core_version: '1.14.2', server_ip: '192.0.2.1', proxy_port: 2096 }]
const subscription = { active: true, links: [], profile: { username: 'demo', status: 1, sub_token: 'test-subscription', used_up_bytes: 100, used_down_bytes: 200, traffic_limit_bytes: 0 } }
const fixtures = {
  '/api/v1/nodes': nodes,
  '/api/v1/subscription': subscription,
  '/api/v1/template': { reality_server_name: 'www.amazon.com', reality_dest: 'www.amazon.com:443', hy2_up_mbps: 0, hy2_down_mbps: 200 },
  '/api/v1/system/profile': { username: 'demo' },
  '/api/v1/traffic': { total: { uplink: 100, downlink: 200 }, hosts: [], protocols: [], users: [] }
}

async function mockAPI(page, { token = true, initialized = true } = {}) {
  const calls = [], errors = []
  if (token) await page.addInitScript(() => localStorage.setItem('sm_ui_token', 'browser-test-session'))
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    if (path === '/api/v1/events') return route.fulfill({ contentType: 'text/event-stream', body: ': test\n\n' })
    const data = path === '/api/v1/system/setup/status' ? { is_initialized: initialized, version: '0.2.2', core_version: 'v1.14.2' } : fixtures[path]
    return route.fulfill({ json: data ?? {} })
  })
  return { calls, errors }
}

function hold(page, path) {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const handler = async route => {
    await pending
    try { await route.fallback() } catch { /* The page may have cancelled this read. */ }
  }
  return page.route(`**${path}`, handler).then(() => async () => {
    release()
    await page.unroute(`**${path}`, handler)
  })
}

const destinations = [
  { name: '仪表盘', hash: '#/', title: '集群全景概览', api: '/api/v1/subscription', skeleton: '正在加载主机概览…' },
  { name: '节点主机', hash: '#/nodes', title: '节点主机管理 (Node Hosts)', api: '/api/v1/nodes', skeleton: '正在加载主机列表…' },
  { name: '协议模板', hash: '#/inbounds', title: '协议模板配置 (Inbound)', api: '/api/v1/template', skeleton: '正在读取协议模板…' },
  { name: '管理员设置', hash: '#/settings', title: '管理员设置 (Account)', api: '/api/v1/system/profile', skeleton: '正在加载管理员信息…' },
  { name: '订阅链接', hash: '#/subscription', title: '订阅链接', api: '/api/v1/subscription', skeleton: '正在加载订阅…' }
]

for (const destination of destinations) {
  test(`${destination.name}: navigation renders immediately, data fills the skeleton later`, async ({ page }) => {
    const { calls, errors } = await mockAPI(page)
    await page.goto('/#/settings')
    await expect(page.getByLabel('管理员用户名', { exact: false })).toHaveValue('demo')
    if (destination.hash === '#/settings') {
      await page.locator('aside').getByRole('link', { name: /订阅链接/ }).click()
      await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
    }
    const release = await hold(page, destination.api)
    const start = Date.now()
    await page.locator('aside').getByRole('link', { name: new RegExp(destination.name) }).click()
    await expect(page.getByRole('heading', { name: destination.title, exact: true })).toBeVisible({ timeout: 1000 })
    await expect(page).toHaveURL(new RegExp(destination.hash.replace('/', '\\/') + '$'))
    await expect(page.getByRole('status', { name: destination.skeleton })).toBeVisible()
    expect(Date.now() - start).toBeLessThan(1000)
    expect(calls.filter(path => path === '/api/v1/system/setup/status')).toHaveLength(1)
    if (destination.hash === '#/') await expect(page.getByText(/暂无接入主机/)).toHaveCount(0)
    if (destination.hash === '#/inbounds') await expect(page.getByLabel('服务器下行 (Mbps)')).toHaveCount(0)
    if (destination.hash === '#/nodes') await page.screenshot({ path: test.info().outputPath('desktop-loading.png') })
    await release()
    await expect(page.getByRole('status', { name: destination.skeleton })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('a stalled read can be left immediately and is cancelled; later menu clicks do not query setup', async ({ page }) => {
  const { calls } = await mockAPI(page)
  await page.goto('/#/subscription')
  await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
  await page.clock.install()
  await page.evaluate(() => {
    const original = window.fetch
    window.fetch = (input, options) => {
      if (input === '/api/v1/system/profile') {
        window.profileReadSignal = options.signal
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)))
      }
      return original(input, options)
    }
  })
  await page.locator('aside').getByRole('link', { name: /管理员设置/ }).click()
  await expect(page.getByRole('status', { name: '正在加载管理员信息…' })).toBeVisible()
  await page.locator('aside').getByRole('link', { name: /订阅链接/ }).click()
  await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
  expect(await page.evaluate(() => window.profileReadSignal.aborted)).toBe(true)
  await page.getByRole('tab', { name: '客户端导入' }).click()
  await expect(page.getByRole('tab', { name: '客户端导入' })).toHaveAttribute('aria-selected', 'true')
  expect(calls.filter(path => path === '/api/v1/system/setup/status')).toHaveLength(1)
})

test('a 10 second timeout replaces the skeleton with a retry and successful retry fills the page', async ({ page }) => {
  await mockAPI(page)
  await page.goto('/#/subscription')
  await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
  await page.clock.install()
  await page.evaluate(() => {
    const original = window.fetch
    let stall = true
    window.fetch = (input, options) => {
      if (input === '/api/v1/system/profile' && stall) {
        stall = false
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)))
      }
      return original(input, options)
    }
  })
  await page.locator('aside').getByRole('link', { name: /管理员设置/ }).click()
  await expect(page.getByRole('status', { name: '正在加载管理员信息…' })).toBeVisible()
  await page.clock.fastForward(10001)
  await expect(page.getByRole('alert')).toContainText('请求超时')
  await expect(page.locator('#admin-username')).toHaveCount(0)
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.locator('#admin-username')).toHaveValue('demo')
})

test('failed bootstrap is visible and retry preserves the initial deep link', async ({ page }) => {
  await mockAPI(page)
  let failed = true
  await page.route('**/api/v1/system/setup/status', route => failed
    ? route.fulfill({ status: 503, json: { error: '主控暂时不可用' } })
    : route.fallback())
  await page.goto('/#/nodes')
  await expect(page.getByRole('alert')).toContainText('主控暂时不可用')
  await expect(page.getByRole('heading', { name: /初始引导/ })).toHaveCount(0)
  failed = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('table')).toContainText('Master Demo')
  await expect(page).toHaveURL(/#\/nodes$/)
})

test('first bootstrap has a skeleton and malformed status does not expose the setup form', async ({ page }) => {
  await mockAPI(page, { token: false })
  await page.route('**/api/v1/system/setup/status', route => route.fulfill({ json: {} }))
  const release = await hold(page, '/api/v1/system/setup/status')
  await page.goto('/#/setup')
  await expect(page.getByRole('status', { name: '正在连接主控…' })).toBeVisible()
  await expect(page.locator('form')).toHaveCount(0)
  await release()
  await expect(page.getByRole('alert')).toContainText('初始化状态响应无效')
})

test('uninitialized installation goes through setup and enters the dashboard without a second setup read', async ({ page }) => {
  const { calls } = await mockAPI(page, { token: false, initialized: false })
  await page.route('**/api/v1/system/setup', route => route.fulfill({ json: { token: 'new-test-session' } }))
  await page.goto('/#/nodes')
  await expect(page).toHaveURL(/#\/setup$/)
  await page.locator('input[type="password"]').nth(0).fill('test-pass-123')
  await page.locator('input[type="password"]').nth(1).fill('test-pass-123')
  await page.getByRole('button', { name: '完成设置并进入系统' }).click()
  await expect(page.getByRole('heading', { name: '集群全景概览' })).toBeVisible()
  expect(calls.filter(path => path === '/api/v1/system/setup/status')).toHaveLength(1)
})

test('protected routes require login and an expired session redirects back to login', async ({ page }) => {
  await mockAPI(page, { token: false })
  await page.route('**/api/v1/auth/login', route => route.fulfill({ json: { token: 'login-test-session' } }))
  await page.goto('/#/nodes')
  await expect(page.getByRole('heading', { name: 'SM-UI 登录' })).toBeVisible()
  await page.getByPlaceholder('默认: admin').fill('demo')
  await page.getByPlaceholder('输入管理密码').fill('test-pass-123')
  await page.getByRole('button', { name: '立即登录' }).click()
  await expect(page.getByRole('heading', { name: '集群全景概览' })).toBeVisible()
  await page.route('**/api/v1/system/profile', route => route.fulfill({ status: 401, json: { error: 'expired' } }))
  await page.locator('aside').getByRole('link', { name: /管理员设置/ }).click()
  await expect(page.getByRole('heading', { name: 'SM-UI 登录' })).toBeVisible()
})

test('mobile navigation shows the destination skeleton without overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockAPI(page)
  await page.goto('/#/subscription')
  await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
  const release = await hold(page, '/api/v1/nodes')
  await page.getByRole('navigation', { name: '移动导航' }).getByRole('link', { name: '节点', exact: true }).click()
  await expect(page.getByRole('status', { name: '正在加载主机列表…' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('mobile-loading.png') })
  await release()
})

for (const destination of destinations) {
  test(`${destination.name}: a failed initial read shows a retry instead of empty or default data`, async ({ page }) => {
    await mockAPI(page)
    let failed = true
    await page.route(`**${destination.api}`, route => failed
      ? route.fulfill({ status: 503, json: { error: '测试：数据暂时不可用' } })
      : route.fallback())
    await page.goto('/' + destination.hash)
    const alert = page.getByRole('alert').filter({ hasText: '测试：数据暂时不可用' })
    await expect(alert).toBeVisible()
    await expect(page.getByRole('status', { name: destination.skeleton })).toHaveCount(0)
    await expect(page.getByText(/暂无接入主机/)).toHaveCount(0)
    failed = false
    await alert.getByRole('button', { name: /重试|重新加载/ }).click()
    await expect(alert).toHaveCount(0)
    await expect(page.getByRole('status', { name: destination.skeleton })).toHaveCount(0)
  })
}

test('subscription background refresh preserves the selected tab and last data on failure', async ({ page }) => {
  await mockAPI(page)
  await page.goto('/#/subscription')
  await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
  await page.getByRole('tab', { name: '客户端导入' }).click()
  await page.route('**/api/v1/subscription', route => route.fulfill({ status: 503, json: { error: '刷新失败' } }))
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('上次成功获取的数据')
  await expect(page.getByRole('tab', { name: '客户端导入' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('status', { name: '正在加载订阅…' })).toHaveCount(0)
})

test('sidebar shows the running SM-UI build and hosts show the reported core', async ({ page }) => {
  await mockAPI(page)
  await page.route('**/api/v1/system/setup/status', route => route.fulfill({ json: { is_initialized: true, version: 'v0.9.7', core_version: 'v1.14.2' } }))
  await page.goto('/#/nodes')
  await expect(page.getByTestId('app-version')).toHaveText('SM-UI v0.9.7')
  const row = page.getByRole('row').filter({ hasText: 'Master Demo' })
  await expect(row).toContainText('singbox:v1.14.2')
  await expect(row).not.toContainText('TCP (Reality) + UDP (Hy2)')
  await page.screenshot({ path: test.info().outputPath('fixed-version-hosts.png') })

  // A node awaiting the new release must never be labelled as already upgraded.
  await page.route('**/api/v1/nodes', route => route.fulfill({ json: [{ ...nodes[0], core_version: 'v1.11.4' }] }))
  await page.reload()
  await expect(row).toContainText('singbox:v1.11.4')
})

test('host forms always use both protocols and send no protocol selection', async ({ page }) => {
  await mockAPI(page)
  const writes = []
  page.on('dialog', dialog => dialog.accept())
  await page.route('**/api/v1/nodes*', route => {
    const req = route.request()
    if (req.method() === 'POST' || req.method() === 'PUT') {
      writes.push(req.postDataJSON())
      return route.fulfill({ json: { node: { ...nodes[0], ...req.postDataJSON() } } })
    }
    return route.fallback()
  })
  await page.route('**/api/v1/nodes/1', route => {
    writes.push(route.request().postDataJSON())
    return route.fulfill({ json: nodes[0] })
  })
  await page.goto('/#/nodes')
  await page.getByRole('button', { name: '配置主机属性' }).click()
  await expect(page.getByText('TCP (Reality) + UDP (Hy2)', { exact: true })).toBeVisible()
  await expect(page.locator('form').getByRole('combobox')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('fixed-protocol-editor.png') })
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('heading', { name: '主机属性配置' })).toHaveCount(0)
  await page.getByRole('button', { name: '添加接入主机' }).click()
  await expect(page.getByText('TCP (Reality) + UDP (Hy2)', { exact: true })).toBeVisible()
  await expect(page.locator('form').getByRole('combobox')).toHaveCount(0)
  await page.getByPlaceholder('例如: US01 / 香港BGP').fill('new-host')
  await page.getByRole('button', { name: '生成一键纳管指令' }).click()
  await expect(page.getByRole('heading', { name: '主机专属部署指令' })).toBeVisible()
  expect(writes).toHaveLength(2)
  for (const body of writes) expect(body).not.toHaveProperty('protocol')
})

test('templates retain bandwidth settings without a core switch', async ({ page }) => {
  const { calls } = await mockAPI(page)
  await page.goto('/#/inbounds')
  await expect(page.getByLabel('服务器下行 (Mbps)')).toHaveValue('200')
  await expect(page.getByText('sing-box 核心版本', { exact: true })).toHaveCount(0)
  await expect(page.locator('#core-version')).toHaveCount(0)
  expect(calls.filter(path => /\/nodes(?:\/.*\/core)?$/.test(path))).toHaveLength(0)
})
