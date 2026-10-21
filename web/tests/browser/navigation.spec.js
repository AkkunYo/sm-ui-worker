import { test, expect } from '@playwright/test'

// Mock data mirrors the current Worker responses (src/routes/*.ts).
const VERSION = '1.14.3-1'
const tenant = { id: 2, username: 'demo', role: 'user', sub_token: 'test-subscription', traffic_limit_bytes: 0, used_up_bytes: 100, used_down_bytes: 200, expire_at: null }
const admin = { ...tenant, id: 1, username: 'admin', role: 'admin' }

const templates = [
  { id: 1, name: 'HK VLESS 主力', protocol: 'vless', listen_port: 2096, reality_server_name: 'www.amazon.com', reality_dest: 'www.amazon.com:443', reality_short_id: 'a1b2c3d4e5f60718', hy2_up_mbps: 100, hy2_down_mbps: 100, hy2_masquerade: 'https://bing.com', hy2_obfs_password: '', tuic_congestion_control: 'bbr', is_default: 1, updated_at: '2026-10-21 10:00:00' },
  { id: 2, name: 'HK Hy2 加速', protocol: 'hysteria2', listen_port: 2096, reality_server_name: null, reality_dest: null, reality_short_id: '', hy2_up_mbps: 50, hy2_down_mbps: 200, hy2_masquerade: 'https://www.apple.com', hy2_obfs_password: '', tuic_congestion_control: 'bbr', is_default: 1, updated_at: '2026-10-21 10:00:00' },
  { id: 4, name: 'TUIC 备用', protocol: 'tuic', listen_port: 8443, reality_server_name: null, reality_dest: null, reality_short_id: '', hy2_up_mbps: 100, hy2_down_mbps: 100, hy2_masquerade: 'https://bing.com', hy2_obfs_password: '', tuic_congestion_control: 'bbr', is_default: 0, updated_at: '2026-10-21 10:00:00' }
]
const slot = (nodeId, templateId) => {
  const t = templates.find(item => item.id === templateId)
  return { id: nodeId * 10 + templateId, node_id: nodeId, template_id: t.id, enabled: 1, template_name: t.name, protocol: t.protocol, listen_port: t.listen_port, hy2_obfs_password: t.hy2_obfs_password }
}
const node = fields => ({
  owner_id: tenant.id, owner_username: tenant.username, status: 'online', desired_state: 'active', token: 'node-token-1',
  rtt_ms: 12, cpu_percent: 8.5, memory_percent: 31.2, uptime_seconds: 86400, used_up_bytes: 0, used_down_bytes: 0,
  agent_version: VERSION, cert_sha256: '', last_apply_error: '', core_state: 'running', config_status: 'applied', is_local: false,
  ...fields
})
const nodes = [node({ id: 1, name: 'Master Demo', server_ip: '192.0.2.1', inbounds: [slot(1, 1), slot(1, 2)] })]

function fixtures(user, version, initialized, nodeList) {
  return {
    '/api/v1/system/setup/status': { is_initialized: initialized, version, protocol_version: 2 },
    '/api/v1/system/profile': user,
    '/api/v1/nodes': nodeList,
    '/api/v1/templates': templates,
    '/api/v1/subscription': {
      profile: { id: user.id, username: user.username, role: user.role, sub_token: user.sub_token, status: 1, traffic_limit_bytes: 0, used_up_bytes: 100, used_down_bytes: 200, expire_at: null },
      active: true,
      links: [{ name: 'Master Demo-VLESS-192.0.2.1', protocol: 'vless', uri: 'vless://uuid@192.0.2.1:2096?security=reality#Master%20Demo' }],
      mode: 'personal'
    },
    '/api/v1/traffic': { total: { uplink: 100, downlink: 200 }, hosts: [], protocols: [], users: [] },
    '/api/v1/users': [],
    '/api/v1/auth/logout': { success: true }
  }
}
// The router only checks that a session marker exists; the real session is an HttpOnly cookie.
async function mockAPI(page, { session = true, initialized = true, user = tenant, version = VERSION, nodeList = nodes } = {}) {
  const calls = [], errors = []
  if (session) {
    await page.addInitScript(u => {
      localStorage.setItem('sm_ui_token', 'cookie')
      localStorage.setItem('sm_ui_user', JSON.stringify(u))
    }, user)
  }
  page.on('pageerror', error => errors.push(error.message))
  const data = fixtures(user, version, initialized, nodeList)
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    if (!(path in data)) return route.fulfill({ status: 404, json: { error: `unmocked ${path}` } })
    return route.fulfill({ json: data[path] })
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

const navLink = (page, name) => page.locator('aside').getByRole('link', { name: new RegExp(name) })
const setupReads = calls => calls.filter(path => path === '/api/v1/system/setup/status')

const destinations = [
  { name: '仪表盘', hash: '#/', title: '集群全景概览', api: '/api/v1/subscription', skeleton: '正在加载主机概览…',
    empty: page => page.getByText('主机在线率'), ready: page => page.getByText('Master Demo').first() },
  { name: '节点主机', hash: '#/nodes', title: '节点主机管理 (Node Hosts)', api: '/api/v1/nodes', skeleton: '正在加载主机列表…',
    empty: page => page.getByText(/暂无接入主机/), ready: page => page.getByRole('row').filter({ hasText: 'Master Demo' }) },
  { name: '协议模板', hash: '#/inbounds', title: '协议主模板池 (Master Templates)', api: '/api/v1/templates', skeleton: '正在读取协议模板池…',
    empty: page => page.getByText('暂无可用协议模板'), ready: page => page.getByRole('row').filter({ hasText: 'HK VLESS 主力' }) },
  { name: '账号设置', hash: '#/settings', title: '账号设置 (Account)', api: '/api/v1/system/profile', skeleton: '正在加载账号信息…',
    empty: page => page.locator('#account-username'), ready: page => page.locator('#account-username') },
  { name: '订阅链接', hash: '#/subscription', title: '订阅链接', api: '/api/v1/subscription', skeleton: '正在加载订阅…',
    empty: page => page.getByText('订阅状态'), ready: page => page.getByRole('tab', { name: '客户端导入' }) }
]
for (const destination of destinations) {
  test(`${destination.name}: navigation renders immediately, data fills the skeleton later`, async ({ page }) => {
    const { calls, errors } = await mockAPI(page)
    await page.goto('/#/settings')
    await expect(page.locator('#account-username')).toHaveValue('demo')
    if (destination.hash === '#/settings') {
      await navLink(page, '订阅链接').click()
      await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
    }
    const release = await hold(page, destination.api)
    const start = Date.now()
    await navLink(page, destination.name).click()
    await expect(page.getByRole('heading', { name: destination.title, exact: true })).toBeVisible({ timeout: 1000 })
    await expect(page).toHaveURL(new RegExp(destination.hash.replace('/', '\\/') + '$'))
    await expect(page.getByRole('status', { name: destination.skeleton })).toBeVisible()
    expect(Date.now() - start).toBeLessThan(1000)
    expect(setupReads(calls)).toHaveLength(1)
    // While the read is pending no empty/default content may be shown.
    await expect(destination.empty(page)).toHaveCount(0)
    await release()
    await expect(page.getByRole('status', { name: destination.skeleton })).toHaveCount(0)
    await expect(destination.ready(page)).toBeVisible()
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
  await navLink(page, '账号设置').click()
  await expect(page.getByRole('status', { name: '正在加载账号信息…' })).toBeVisible()
  await navLink(page, '订阅链接').click()
  await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
  expect(await page.evaluate(() => window.profileReadSignal.aborted)).toBe(true)
  await page.getByRole('tab', { name: '客户端导入' }).click()
  await expect(page.getByRole('tab', { name: '客户端导入' })).toHaveAttribute('aria-selected', 'true')
  expect(setupReads(calls)).toHaveLength(1)
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
  await navLink(page, '账号设置').click()
  await expect(page.getByRole('status', { name: '正在加载账号信息…' })).toBeVisible()
  await page.clock.fastForward(10001)
  await expect(page.getByRole('alert')).toContainText('请求超时')
  await expect(page.locator('#account-username')).toHaveCount(0)
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.locator('#account-username')).toHaveValue('demo')
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
  await expect(page.getByRole('row').filter({ hasText: 'Master Demo' })).toBeVisible()
  await expect(page).toHaveURL(/#\/nodes$/)
})

test('first bootstrap has a skeleton and malformed status does not expose the setup form', async ({ page }) => {
  await mockAPI(page, { session: false })
  await page.route('**/api/v1/system/setup/status', route => route.fulfill({ json: {} }))
  const release = await hold(page, '/api/v1/system/setup/status')
  await page.goto('/#/setup')
  await expect(page.getByRole('status', { name: '正在连接主控…' })).toBeVisible()
  await expect(page.locator('form')).toHaveCount(0)
  await release()
  await expect(page.getByRole('alert')).toContainText('初始化状态响应无效')
  await expect(page.locator('form')).toHaveCount(0)
})
test('uninitialized installation goes through setup and enters the dashboard without a second setup read', async ({ page }) => {
  const { calls } = await mockAPI(page, { session: false, initialized: false, user: admin })
  const submitted = []
  await page.route('**/api/v1/system/setup', route => {
    submitted.push(route.request().postDataJSON())
    return route.fulfill({ json: { success: true, user: { id: 1, username: 'admin', role: 'admin' } } })
  })
  await page.goto('/#/nodes')
  await expect(page).toHaveURL(/#\/setup$/)
  await expect(page.getByRole('heading', { name: 'SM-UI 初始引导设置' })).toBeVisible()
  await page.locator('input[type="password"]').nth(0).fill('test-pass-123')
  await page.locator('input[type="password"]').nth(1).fill('test-pass-123')
  await page.getByRole('button', { name: '完成设置并进入系统' }).click()
  await expect(page.getByRole('heading', { name: '集群全景概览' })).toBeVisible()
  expect(submitted).toEqual([{ username: 'admin', password: 'test-pass-123', confirm_password: 'test-pass-123' }])
  expect(setupReads(calls)).toHaveLength(1)
})

test('protected routes require login and an expired session redirects back to login', async ({ page }) => {
  await mockAPI(page, { session: false })
  await page.route('**/api/v1/auth/login', route => route.fulfill({ json: { success: true, user: { id: tenant.id, username: 'demo', role: 'user' } } }))
  await page.goto('/#/nodes')
  await expect(page.getByRole('heading', { name: 'SM-UI 登录' })).toBeVisible()
  await page.getByPlaceholder('默认: admin').fill('demo')
  await page.getByPlaceholder('输入管理密码').fill('test-pass-123')
  await page.getByRole('button', { name: '立即登录' }).click()
  await expect(page.getByRole('heading', { name: '集群全景概览' })).toBeVisible()
  await page.route('**/api/v1/system/profile', route => route.fulfill({ status: 401, json: { error: 'expired' } }))
  await navLink(page, '账号设置').click()
  await expect(page.getByRole('heading', { name: 'SM-UI 登录' })).toBeVisible()
  await expect(page).toHaveURL(/#\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('sm_ui_token'))).toBeNull()
})

test('mobile navigation shows the destination skeleton without overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockAPI(page)
  await page.goto('/#/subscription')
  await expect(page.getByRole('tab', { name: '客户端导入' })).toBeVisible()
  const release = await hold(page, '/api/v1/nodes')
  await page.getByRole('navigation', { name: '移动导航' }).getByRole('link', { name: '主机', exact: true }).click()
  await expect(page.getByRole('status', { name: '正在加载主机列表…' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await release()
  await expect(page.getByRole('status', { name: '正在加载主机列表…' })).toHaveCount(0)
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
    // Known gap on 协议模板, covered by the expected-failure test below.
    if (destination.hash !== '#/inbounds') await expect(destination.empty(page)).toHaveCount(0)
    failed = false
    await alert.getByRole('button', { name: /重试|重新加载/ }).click()
    await expect(alert).toHaveCount(0)
    await expect(page.getByRole('status', { name: destination.skeleton })).toHaveCount(0)
    await expect(destination.ready(page)).toBeVisible()
  })
}

test('协议模板: a failed initial read does not also claim there are no templates', async ({ page }) => {
  // Inbounds.vue renders its empty state ("暂无可用协议模板") next to the load error.
  test.fail(true, 'Inbounds.vue shows the empty state when the initial read fails')
  await mockAPI(page)
  await page.route('**/api/v1/templates', route => route.fulfill({ status: 503, json: { error: '测试：数据暂时不可用' } }))
  await page.goto('/#/inbounds')
  await expect(page.getByRole('alert').filter({ hasText: '测试：数据暂时不可用' })).toBeVisible()
  await expect(page.getByText('暂无可用协议模板')).toHaveCount(0, { timeout: 1000 })
})

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
  await expect(page.getByText('订阅状态')).toBeVisible()
})
test('sidebar shows the controller version and each host shows its single agent version label', async ({ page }) => {
  const pending = node({ id: 2, name: 'Edge Pending', server_ip: '', status: 'offline', agent_version: '', core_state: 'stopped', config_status: 'pending', token: 'node-token-2', inbounds: [] })
  await mockAPI(page, { version: `v${VERSION}`, nodeList: [...nodes, pending] })
  await page.goto('/#/nodes')
  await expect(page.locator('aside').getByText(`v${VERSION}`, { exact: true })).toBeVisible()
  const reported = page.getByRole('row').filter({ hasText: 'Master Demo' })
  await expect(reported).toContainText(`v${VERSION}`)
  const unreported = page.getByRole('row').filter({ hasText: 'Edge Pending' })
  await expect(unreported).toContainText('—')
  await expect(unreported).not.toContainText(/v\d+\.\d+/)
  await expect(page.locator('main')).not.toContainText('singbox:')
  await expect(page.locator('main')).not.toContainText('node:v')
})

test('host forms attach master templates through the multi-select and send template_ids', async ({ page }) => {
  await mockAPI(page)
  const writes = []
  page.on('dialog', dialog => dialog.accept())
  await page.route('**/api/v1/nodes', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    writes.push({ method: 'POST', body })
    return route.fulfill({ json: { node: node({ id: 3, name: body.name, server_ip: '', token: 'node-token-3', inbounds: [] }) } })
  })
  await page.route('**/api/v1/nodes/1', route => {
    writes.push({ method: route.request().method(), body: route.request().postDataJSON() })
    return route.fulfill({ json: { success: true } })
  })
  await page.goto('/#/nodes')

  // Edit: the slots attached to the host are preselected; unselect Hysteria 2.
  await page.getByRole('row').filter({ hasText: 'Master Demo' }).getByRole('button', { name: '配置主机属性' }).click()
  const editForm = page.locator('form')
  await expect(editForm).toContainText('已选 2 / 3')
  await expect(editForm.getByText('VLESS', { exact: true })).toBeVisible()
  await expect(editForm.getByText('HYSTERIA2', { exact: true })).toBeVisible()
  await editForm.getByText('VLESS', { exact: true }).first().click()
  await editForm.getByRole('checkbox', { name: /HYSTERIA2/ }).uncheck()
  await expect(editForm).toContainText('已选 1 / 3')
  await editForm.getByText('VLESS', { exact: true }).first().click()
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('heading', { name: '主机属性配置' })).toHaveCount(0)

  // Add: default templates are preselected; also attach TUIC.
  await page.getByRole('button', { name: '添加接入主机' }).click()
  const addForm = page.locator('form')
  await expect(addForm).toContainText('已选 2 / 3')
  await addForm.getByPlaceholder('例如: US01 / 香港BGP', { exact: true }).fill('new-host')
  await addForm.getByText('VLESS', { exact: true }).first().click()
  await addForm.getByRole('checkbox', { name: /TUIC/ }).check()
  await expect(addForm).toContainText('已选 3 / 3')
  await addForm.getByText('VLESS', { exact: true }).first().click()
  await page.getByRole('button', { name: '生成一键纳管指令' }).click()
  await expect(page.getByRole('heading', { name: '主机专属部署指令' })).toBeVisible()

  expect(writes).toEqual([
    { method: 'PUT', body: { name: 'Master Demo', server_ip: '192.0.2.1', template_ids: [1] } },
    { method: 'POST', body: { owner_id: tenant.id, name: 'new-host', server_ip: '', template_ids: [1, 2, 4] } }
  ])
})
test('install instructions pin docker to the controller version and let the shell script install the latest', async ({ page }) => {
  await mockAPI(page, { version: `v${VERSION}` })
  await page.goto('/#/nodes')
  await page.getByRole('row').filter({ hasText: 'Master Demo' }).getByRole('button', { name: '查看部署命令' }).click()
  await expect(page.getByRole('heading', { name: '主机专属部署指令' })).toBeVisible()
  const command = page.locator('pre')
  // Image tags carry no "v" (sm-node:1.14.3-1); git tags and releases do.
  await expect(command).toContainText(`ghcr.io/akkunyo/sm-node:${VERSION}`)
  await expect(command).not.toContainText('sm-node:v')
  await expect(command).not.toContainText(':latest')
  await page.getByRole('button', { name: 'Docker Compose' }).click()
  await expect(command).toContainText(`image: ghcr.io/akkunyo/sm-node:${VERSION}`)
  await page.getByRole('button', { name: 'Shell 脚本' }).click()
  await expect(command).toContainText('scripts/install.sh')
  await expect(command).toContainText('NODE_TOKEN="node-token-1"')
  await expect(command).not.toContainText('SM_NODE_VERSION')
})

test('templates page keeps the API order, badges default templates and edits Hysteria 2 bandwidth from the API', async ({ page }) => {
  const { calls } = await mockAPI(page, { user: admin })
  await page.goto('/#/inbounds')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(templates.length)
  for (const [index, template] of templates.entries()) {
    const row = rows.nth(index)
    await expect(row.locator('td').first()).toContainText(template.name)
    await expect(row.getByText('默认', { exact: true })).toHaveCount(template.is_default ? 1 : 0)
  }
  await rows.filter({ hasText: 'HK Hy2 加速' }).getByRole('button', { name: '编辑模板' }).click()
  await expect(page.getByRole('heading', { name: '编辑协议模板' })).toBeVisible()
  // The labels are not bound to their inputs, so address each input as the label's sibling.
  const field = label => page.locator('form').locator(`xpath=.//label[normalize-space()="${label}"]/following-sibling::input[1]`)
  await expect(field('服务器上行 (Mbps)')).toHaveValue('50')
  await expect(field('服务器下行 (Mbps)')).toHaveValue('200')
  await expect(field('HTTP 伪装网址')).toHaveValue('https://www.apple.com')
  expect(calls.filter(path => path === '/api/v1/templates')).toHaveLength(1)
})
