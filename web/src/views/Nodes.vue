<template>
  <div class="p-8 space-y-8 max-w-7xl mx-auto">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-white">节点主机管理 (Node Hosts)</h1>
        <p class="text-sm text-slate-400 mt-1">管理通过反向 WSS 长连接入的 VPS 主机实例与专属 UUID 凭证，自动感知公网 IP 并点亮在线状态</p>
      </div>
      <button
        @click="openAddModal"
        class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition flex items-center space-x-2 shadow-lg shadow-emerald-500/20"
      >
        <Plus class="w-4 h-4" />
        <span>添加接入主机</span>
      </button>
    </div>

    <div v-if="loadError" role="alert" class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
      {{ loadError }}<span v-if="loaded">，当前展示上次成功获取的数据。</span>
      <button type="button" :disabled="loading" @click="loadNodes" class="ml-3 underline disabled:opacity-50">重试</button>
    </div>
    <PageSkeleton v-if="!loaded && !loadError" label="正在加载主机列表…" />
    <!-- Tenant Filter (Admin Only) -->
    <div v-if="isAdmin && tenantList.length > 0" class="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
      <div class="flex items-center space-x-2 text-xs text-slate-300">
        <Users class="w-4 h-4 text-violet-400" />
        <span class="font-medium">筛选租户主机:</span>
        <select v-model="selectedTenantFilter" @change="loadNodes" class="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none">
          <option value="">全部租户主机 ({{ nodes.length }}台)</option>
          <option v-for="t in tenantList" :key="t.id" :value="t.id">{{ t.username }} ({{ t.node_count || 0 }}台)</option>
        </select>
      </div>
      <span class="text-xs text-slate-500">已启用多租户强隔离模式</span>
    </div>

    <!-- Nodes Table -->
    <div v-if="loaded" class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm text-slate-300">
          <thead class="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th class="px-5 py-3.5 font-semibold w-28">操作</th>
              <th v-if="isAdmin" class="px-5 py-3.5 font-semibold">所属租户</th>
              <th class="px-5 py-3.5 font-semibold">名称</th>
              <th class="px-5 py-3.5 font-semibold">
                <div class="flex items-center space-x-1.5">
                  <span>地址</span>
                  <button
                    type="button"
                    @click="hideAddresses = !hideAddresses"
                    class="p-0.5 rounded text-slate-400 hover:text-white transition"
                    :title="hideAddresses ? '显示真实地址' : '隐藏脱敏地址'"
                  >
                    <EyeOff v-if="hideAddresses" class="w-3.5 h-3.5 text-slate-400" />
                    <Eye v-else class="w-3.5 h-3.5 text-emerald-400" />
                  </button>
                </div>
              </th>
              <th class="px-5 py-3.5 font-semibold">CPU</th>
              <th class="px-5 py-3.5 font-semibold">内存</th>
              <th class="px-5 py-3.5 font-semibold">运行时长</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
            <tr v-if="nodes.length === 0">
              <td :colspan="isAdmin ? 7 : 6" class="px-6 py-12 text-center text-slate-500">
                暂无接入主机，点击右上角“添加接入主机”生成专属 UUID 与一键纳管指令。
              </td>
            </tr>
            <tr v-for="node in nodes" :key="node.id" class="hover:bg-slate-800/30 transition">
              <!-- 1. Left Actions (Power Toggle + Configure + Command + Delete) -->
              <td class="px-5 py-3.5">
                <div class="flex items-center space-x-1.5">
                  <button
                    @click="toggleNodePower(node)"
                    :disabled="togglingId === node.id"
                    :title="node.status === 'disabled' ? '点击启用主机' : '点击停用主机'"
                    class="p-1.5 rounded-lg border transition shadow-sm"
                    :class="node.status !== 'disabled'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/40'
                      : 'bg-slate-800 text-slate-500 border-slate-700 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/40'"
                  >
                    <Power class="w-3.5 h-3.5" />
                  </button>
                  <button
                    @click="openEditModal(node)"
                    class="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition"
                    title="配置主机属性"
                  >
                    <Sliders class="w-3.5 h-3.5" />
                  </button>
                  <button
                    v-if="!node.is_local"
                    @click="openInstructionModal(node)"
                    class="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition"
                    title="查看部署命令"
                  >
                    <Terminal class="w-3.5 h-3.5" />
                  </button>
                  <button
                    v-if="!node.is_local"
                    @click="deleteNode(node.id)"
                    class="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition"
                    title="删除主机"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>

              <!-- Owner Tag (Admin Only) -->
              <td v-if="isAdmin" class="px-5 py-3.5">
                <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20">
                  {{ node.owner_username || 'Admin' }}
                </span>
              </td>

              <!-- 2. Name & Status/Latency -->
              <td class="px-5 py-3.5">
                <div>
                  <div class="flex items-center space-x-2">
                    <p class="font-medium text-white text-sm">{{ node.name }}</p>
                    <span
                      v-if="node.is_local"
                      class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                    >本机 Master</span>
                  </div>
                  <!-- Status & Latency indicator replacing HostId -->
                  <div class="flex items-center space-x-1.5 mt-1">
                    <span
                      v-if="node.status === 'disabled'"
                      class="inline-flex items-center space-x-1 text-slate-500 text-xs"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
                      <span class="text-[11px]">已停用</span>
                    </span>
                    <div
                      v-else-if="node.status === 'online'"
                      class="inline-flex items-center space-x-1.5"
                    >
                      <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span class="font-mono text-[11px] font-medium text-emerald-400">
                        {{ node.rtt_ms || 0 }} ms
                      </span>
                    </div>
                    <div
                      v-else
                      class="inline-flex items-center space-x-1 text-rose-400 text-xs"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      <span class="text-[11px] font-medium">离线</span>
                    </div>
                  </div>
                  <p v-if="node.core_error" :title="node.core_error" class="text-[10px] text-amber-300 max-w-44 truncate mt-0.5">{{ node.core_error }}</p>
                  <p v-if="node.last_error" :title="node.last_error" class="text-[10px] text-rose-300 max-w-44 truncate mt-0.5">{{ node.last_error }}</p>
                </div>
              </td>

              <!-- 3. Address with Masking & Inbound Slots -->
              <td class="px-5 py-3.5">
                <div :class="hideAddresses ? 'filter blur-[4.5px] select-none transition-all duration-200' : 'transition-all duration-200'">
                  <div v-if="node.server_ip" class="space-y-0.5">
                    <div v-for="ip in node.server_ip.split(',')" :key="ip" class="font-mono text-xs text-slate-200">
                      {{ ip.trim() }}
                    </div>
                  </div>
                  <div v-else-if="node.is_local" class="font-mono text-xs text-emerald-400">
                    <div>本机 Master</div>
                  </div>
                  <div v-else class="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    <span>待接入</span>
                  </div>
                </div>

                <!-- Inbound Slots Badges -->
                <div v-if="node.inbounds && node.inbounds.length > 0" class="flex flex-wrap gap-1 mt-1.5">
                  <span
                    v-for="slot in node.inbounds"
                    :key="slot.id || (slot.template_id + '-' + slot.listen_port)"
                    class="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex items-center gap-1"
                    :class="slot.enabled === 0
                      ? 'bg-slate-800/60 text-slate-500 border border-slate-700/50 line-through'
                      : slot.protocol === 'vless'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'"
                  >
                    <span>{{ slot.protocol === 'vless' ? 'VLESS' : 'Hy2' }}:{{ slot.listen_port }}</span>
                    <span v-if="slot.hop_ports" class="text-[9px] text-sky-300/80">⇄Hop</span>
                  </span>
                </div>
                <div v-else class="text-[10px] text-slate-500 font-mono mt-1">
                  :{{ node.proxy_port || 2096 }}
                </div>

                <div class="text-[10px] text-slate-500 font-mono mt-1 flex items-center space-x-1.5 flex-wrap">
                  <span>singbox:{{ displayCoreVersion(node.core_version) }}</span>
                  <span v-if="node.agent_version" class="text-slate-600">|</span>
                  <span v-if="node.agent_version" class="text-slate-400">node:{{ displayCoreVersion(node.agent_version) }}</span>
                </div>
              </td>

              <!-- 4. CPU -->
              <td class="px-5 py-3.5">
                <div class="space-y-1 w-24">
                  <div class="flex justify-between text-xs">
                    <span class="font-mono text-slate-200">{{ node.cpu_percent ? node.cpu_percent.toFixed(1) : 0 }}%</span>
                  </div>
                  <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      class="bg-emerald-500 h-1.5 rounded-full transition-all"
                      :style="{ width: `${Math.min(node.cpu_percent || 0, 100)}%` }"
                    ></div>
                  </div>
                </div>
              </td>

              <!-- 6. Memory -->
              <td class="px-5 py-3.5">
                <div class="space-y-1 w-24">
                  <div class="flex justify-between text-xs">
                    <span class="font-mono text-slate-200">{{ node.memory_percent ? node.memory_percent.toFixed(1) : 0 }}%</span>
                  </div>
                  <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      class="bg-blue-500 h-1.5 rounded-full transition-all"
                      :style="{ width: `${Math.min(node.memory_percent || 0, 100)}%` }"
                    ></div>
                  </div>
                </div>
              </td>

              <!-- 7. Uptime -->
              <td class="px-5 py-3.5 font-mono text-xs text-slate-300">
                {{ formatUptime(node.uptime_seconds) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 1. Add Node Modal -->
    <Teleport to="body">
      <div v-if="showAddModal" @click.self="showAddModal = false" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-white">添加接入主机 (生成专属 HostId)</h2>
            <p class="text-xs text-slate-400 mt-0.5">为该 VPS 实例分配独一无二的 HostId 与专属 WSS 反向长连接入地址</p>
          </div>
          <button @click="showAddModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>

        <form @submit.prevent="createNode" class="space-y-4">
          <div v-if="isAdmin && tenantList.length > 0">
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              指定所属租户用户
            </label>
            <select
              v-model="addForm.owner_id"
              class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option v-for="t in tenantList" :key="t.id" :value="t.id">{{ t.username }} ({{ t.role === 'admin' ? '超管' : '租户' }})</option>
            </select>
            <p class="text-[11px] text-slate-500 mt-1">选中的租户将独占纳管该主机，且仅在该租户的订阅中下发。</p>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              主机备注名称 <span class="text-rose-400">* (不得重复)</span>
            </label>
            <input
              v-model="addForm.name"
              type="text"
              required
              class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="例如: US01 / 香港BGP"
            />
            <p class="text-[11px] text-slate-500 mt-1">每个备注名对应一台 VPS 实例并分配独一无二的 HostId。订阅节点名格式为“<code class="text-emerald-400 font-mono">备注名-IP</code>”（如：<code class="text-emerald-400 font-mono">US01-vless-45.1.1.1</code>）</p>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              指定公网出口 IP 或域名 (可选)
            </label>
            <input
              v-model="addForm.server_ip"
              type="text"
              class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:border-emerald-500 focus:outline-none font-mono"
              placeholder="留空则在子节点连接时自动识别（推荐）"
            />
            <p class="text-[11px] text-slate-500 mt-1">若留空，当子节点启动并连入 Master 时，系统会自动提取其连接来源 IP 填入</p>
          </div>

          <!-- Inbound Slots Section -->
          <div class="space-y-3 pt-2 border-t border-slate-800">
            <div class="flex items-center justify-between">
              <div>
                <label class="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  端口与协议插槽 (Inbound Slots)
                </label>
                <p class="text-[11px] text-slate-500">将模板池挂载到主机端口，支持单端口 TCP(VLESS) + UDP(Hy2) 多路复用</p>
              </div>
              <button
                type="button"
                @click="addSlot(addForm)"
                class="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium flex items-center space-x-1 transition"
              >
                <Plus class="w-3.5 h-3.5" />
                <span>添加插槽</span>
              </button>
            </div>

            <div v-if="addForm.inbounds.length === 0" class="p-4 rounded-xl bg-slate-950 border border-dashed border-slate-800 text-center text-xs text-slate-500">
              暂未挂载任何插槽，默认将自动绑定系统默认协议模板。
            </div>

            <div v-else class="space-y-2.5">
              <div
                v-for="(slot, idx) in addForm.inbounds"
                :key="idx"
                class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <select
                      v-model="slot.template_id"
                      class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none"
                    >
                      <option v-for="t in availableTemplates" :key="t.id" :value="t.id">
                        [{{ t.protocol === 'vless' ? 'VLESS' : 'Hy2' }}] {{ t.name }}{{ t.owner_id === null ? ' (系统)' : '' }}
                      </option>
                    </select>
                  </div>
                  <div class="flex items-center space-x-2 shrink-0">
                    <label class="flex items-center space-x-1 text-xs text-slate-400 cursor-pointer">
                      <input type="checkbox" :checked="slot.enabled === 1" @change="slot.enabled = $event.target.checked ? 1 : 0" class="rounded bg-slate-900 border-slate-700 text-emerald-500 w-3.5 h-3.5" />
                      <span class="text-[11px]">启用</span>
                    </label>
                    <button
                      type="button"
                      @click="removeSlot(addForm, idx)"
                      class="p-1 text-slate-500 hover:text-rose-400 transition"
                      title="移除插槽"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label class="block text-[10px] text-slate-400 mb-1">监听端口</label>
                    <input
                      v-model.number="slot.listen_port"
                      type="number"
                      required
                      placeholder="2096"
                      class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none"
                    />
                  </div>
                  <div v-if="getTemplateProtocol(slot.template_id) === 'hysteria2'">
                    <label class="block text-[10px] text-slate-400 mb-1">跳跃端口 (可选)</label>
                    <input
                      v-model="slot.hop_ports"
                      type="text"
                      placeholder="如 22200-22300"
                      class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none"
                    />
                  </div>
                  <div v-else class="flex items-end">
                    <span class="text-[10px] text-slate-500 pb-1.5">TCP 协议监听</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-end space-x-3 pt-3">
            <button
              type="button"
              @click="showAddModal = false"
              class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition"
            >
              取消
            </button>
            <button
              type="submit"
              class="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition shadow-lg shadow-emerald-500/20"
            >
              生成一键纳管指令
            </button>
          </div>
        </form>
      </div>
    </div>
    </Teleport>

    <!-- 2. Deploy Instructions Modal -->
    <Teleport to="body">
      <div v-if="showInstructionModal" @click.self="showInstructionModal = false" class="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center space-x-2">
              <h2 class="text-lg font-bold text-white">主机专属部署指令</h2>
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {{ activeInstructionNode?.name || '新主机' }}
              </span>
            </div>
            <p class="text-xs text-slate-400 mt-0.5">请在目标 VPS 终端执行以下任一命令，容器启动后主机将反向长连 Master 并亮起绿灯</p>
          </div>
          <button @click="showInstructionModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Master Endpoint Config in Modal -->
        <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-300">Master 接入公网地址 (目标 VPS 连接的目标)：</span>
            <div class="flex items-center space-x-3 text-xs">
              <label class="flex items-center space-x-1.5 text-slate-300 cursor-pointer">
                <input type="radio" value="wss" v-model="joinScheme" class="accent-emerald-500" />
                <span>WSS (TLS加密)</span>
              </label>
              <label class="flex items-center space-x-1.5 text-slate-300 cursor-pointer">
                <input type="radio" value="ws" v-model="joinScheme" class="accent-emerald-500" />
                <span>WS (明文端口)</span>
              </label>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <input
              v-model="customMasterHost"
              type="text"
              class="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="例如: 47.251.246.111:3000 或 smui.openapi.cfd"
            />
            <button
              v-if="detectedMasterHost && customMasterHost !== detectedMasterHost"
              @click="customMasterHost = detectedMasterHost"
              type="button"
              class="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition whitespace-nowrap"
              title="还原为自动探测地址"
            >
              还原探测
            </button>
          </div>
          <p class="text-[11px] text-slate-500">
            提示：目标 VPS 将通过此地址反向长连 Master。若此处显示为 localhost，远程机器将无法接入，请修改为 Master 宿主机的公网 IP 或解析域名。
          </p>
        </div>

        <!-- Pinned Permanent WSS (JOIN_URL) -->
        <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
          <div class="flex justify-between items-center text-xs">
            <span class="text-slate-400 font-medium">专属 WSS 接入链接 (含独一无二的 HostId 凭证)：</span>
            <button
              @click="copyCommand(activeJoinURL, 'join_url')"
              class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition flex items-center space-x-1"
            >
              <Check v-if="copiedTab === 'join_url'" class="w-3.5 h-3.5 text-emerald-400" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedTab === 'join_url' ? '已复制' : '复制链接' }}</span>
            </button>
          </div>
          <input
            type="text"
            readonly
            :value="activeJoinURL"
            class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-emerald-400 focus:outline-none select-all font-medium"
          />
        </div>

        <!-- Mode Tabs -->
        <div class="flex space-x-2 border-b border-slate-800 pb-2">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="px-3.5 py-1.5 rounded-lg text-xs font-medium transition"
            :class="activeTab === tab.id ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'"
          >
            {{ tab.name }}
          </button>
        </div>

        <!-- Tab 1: Docker Run -->
        <div v-if="activeTab === 'docker'" class="space-y-2">
          <div class="flex justify-between items-center text-xs text-slate-400">
            <span>在目标 VPS 终端直接执行（推荐）：</span>
            <button
              @click="copyCommand(dockerRunCommand, 'docker')"
              class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition flex items-center space-x-1"
            >
              <Check v-if="copiedTab === 'docker'" class="w-3.5 h-3.5 text-emerald-400" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedTab === 'docker' ? '已复制' : '复制命令' }}</span>
            </button>
          </div>
          <pre class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">{{ dockerRunCommand }}</pre>
        </div>

        <!-- Tab 2: Docker Compose -->
        <div v-if="activeTab === 'compose'" class="space-y-2">
          <div class="flex justify-between items-center text-xs text-slate-400">
            <span>在目标 VPS 创建 <code class="text-slate-200 font-mono">docker-compose.yml</code> 并执行 <code class="text-slate-200 font-mono">docker compose up -d</code>：</span>
            <button
              @click="copyCommand(dockerComposeSnippet, 'compose')"
              class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition flex items-center space-x-1"
            >
              <Check v-if="copiedTab === 'compose'" class="w-3.5 h-3.5 text-emerald-400" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedTab === 'compose' ? '已复制' : '复制代码' }}</span>
            </button>
          </div>
          <pre class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">{{ dockerComposeSnippet }}</pre>
        </div>

        <!-- Tab 3: Shell Script -->
        <div v-if="activeTab === 'shell'" class="space-y-2">
          <div class="flex justify-between items-center text-xs text-slate-400">
            <span>单行一键 Shell 安装脚本：</span>
            <button
              @click="copyCommand(shellCommand, 'shell')"
              class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition flex items-center space-x-1"
            >
              <Check v-if="copiedTab === 'shell'" class="w-3.5 h-3.5 text-emerald-400" />
              <Copy v-else class="w-3.5 h-3.5" />
              <span>{{ copiedTab === 'shell' ? '已复制' : '复制命令' }}</span>
            </button>
          </div>
          <pre class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">{{ shellCommand }}</pre>
        </div>

        <!-- Tip card -->
        <div class="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-start space-x-2 leading-relaxed">
          <span class="font-bold">💡 提示：</span>
          <span>在目标 VPS 执行上述命令后，本页面列表中对应的节点行将<b>自动变为绿色在线状态 🟢</b>。订阅中将自动为各连入的 VPS 生成形如 <code class="font-mono font-bold">{{ activeInstructionNode?.name || 'US01' }}-IP</code> 的代理节点！</span>
        </div>

        <div class="flex justify-end pt-2">
          <button
            @click="showInstructionModal = false"
            class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- 3. Edit Node Host Modal -->
    <Teleport to="body">
      <div v-if="showEditModal" @click.self="showEditModal = false" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-white flex items-center space-x-2">
              <span>主机属性配置</span>
              <span v-if="editForm.is_local" class="px-2 py-0.5 rounded text-xs bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">本机 Master</span>
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">修改该 VPS 主机的备注名称、业务端口、IP 分发模式及子节点属性</p>
          </div>
          <button @click="showEditModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>

        <form @submit.prevent="saveEditNode" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              主机备注名称 <span class="text-rose-400">*</span>
            </label>
            <input
              v-model="editForm.name"
              type="text"
              required
              class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="例如: US01 / 香港BGP / Master"
            />
            <p class="text-[11px] text-slate-500 mt-1">订阅节点格式将命名为“<code class="text-emerald-400 font-mono">{{ editForm.name || 'Node' }}-IP</code>”</p>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              指定公网出口 IP 或域名 (可选)
            </label>
            <input
              v-model="editForm.server_ip"
              type="text"
              class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="留空则自动识别使用（多 IP 逗号隔开）"
            />
            <p class="text-[11px] text-slate-500 mt-1">填写公网 IP 或域名，订阅下发时将以此地址作为连接目标</p>
          </div>

          <!-- Inbound Slots Section for Edit Modal -->
          <div class="space-y-3 pt-2 border-t border-slate-800">
            <div class="flex items-center justify-between">
              <div>
                <label class="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  端口与协议插槽 (Inbound Slots)
                </label>
                <p class="text-[11px] text-slate-500">将模板池挂载到主机端口，支持单端口 TCP(VLESS) + UDP(Hy2) 多路复用</p>
              </div>
              <button
                type="button"
                @click="addSlot(editForm)"
                class="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium flex items-center space-x-1 transition"
              >
                <Plus class="w-3.5 h-3.5" />
                <span>添加插槽</span>
              </button>
            </div>

            <div v-if="!editForm.inbounds || editForm.inbounds.length === 0" class="p-4 rounded-xl bg-slate-950 border border-dashed border-slate-800 text-center text-xs text-slate-500">
              暂未挂载任何插槽，请点击上方“添加插槽”进行配置。
            </div>

            <div v-else class="space-y-2.5">
              <div
                v-for="(slot, idx) in editForm.inbounds"
                :key="idx"
                class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex-1 min-w-0">
                    <select
                      v-model="slot.template_id"
                      class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none"
                    >
                      <option v-for="t in availableTemplates" :key="t.id" :value="t.id">
                        [{{ t.protocol === 'vless' ? 'VLESS' : 'Hy2' }}] {{ t.name }}{{ t.owner_id === null ? ' (系统)' : '' }}
                      </option>
                    </select>
                  </div>
                  <div class="flex items-center space-x-2 shrink-0">
                    <label class="flex items-center space-x-1 text-xs text-slate-400 cursor-pointer">
                      <input type="checkbox" :checked="slot.enabled === 1" @change="slot.enabled = $event.target.checked ? 1 : 0" class="rounded bg-slate-900 border-slate-700 text-emerald-500 w-3.5 h-3.5" />
                      <span class="text-[11px]">启用</span>
                    </label>
                    <button
                      type="button"
                      @click="removeSlot(editForm, idx)"
                      class="p-1 text-slate-500 hover:text-rose-400 transition"
                      title="移除插槽"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label class="block text-[10px] text-slate-400 mb-1">监听端口</label>
                    <input
                      v-model.number="slot.listen_port"
                      type="number"
                      required
                      placeholder="2096"
                      class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none"
                    />
                  </div>
                  <div v-if="getTemplateProtocol(slot.template_id) === 'hysteria2'">
                    <label class="block text-[10px] text-slate-400 mb-1">跳跃端口 (可选)</label>
                    <input
                      v-model="slot.hop_ports"
                      type="text"
                      placeholder="如 22200-22300"
                      class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none"
                    />
                  </div>
                  <div v-else class="flex items-end">
                    <span class="text-[10px] text-slate-500 pb-1.5">TCP 协议监听</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-400 mb-1">主机专属 HostId 凭证</label>
            <input
              type="text"
              readonly
              :value="editForm.token"
              class="w-full px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-400 select-all focus:outline-none"
            />
          </div>

          <div class="flex justify-end space-x-3 pt-3">
            <button
              type="button"
              @click="showEditModal = false"
              class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="savingEdit"
              class="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
            >
              <span v-if="savingEdit">保存中...</span>
              <span v-else>保存修改</span>
            </button>
          </div>
        </form>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { Plus, Trash2, X, Copy, Terminal, Check, Sliders, Power, Eye, EyeOff, Globe, Users } from 'lucide-vue-next'
import { request, getToken, getUser } from '../api'
import PageSkeleton from '../components/PageSkeleton.vue'
import { usePageRead } from '../composables/usePageRead'
const readPage = usePageRead()

const currentUser = computed(() => getUser())
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const tenantList = ref([])
const selectedTenantFilter = ref('')

const nodes = ref([])
const loaded = ref(false)
const loading = ref(false)
const loadError = ref('')
let nodeRevision = 0
const showAddModal = ref(false)
const showInstructionModal = ref(false)
const activeInstructionNode = ref(null)
const joinScheme = ref('ws')
const customMasterHost = ref('')
const detectedMasterHost = ref('')
const activeTab = ref('docker')
const copiedTab = ref('')
const hideAddresses = ref(false)
const togglingId = ref(null)

const activeJoinURL = computed(() => {
  const token = activeInstructionNode.value?.token || ''
  const host = customMasterHost.value.trim() || 'your-master-ip:3000'
  return `${joinScheme.value}://${token}@${host}`
})

const tabs = [
  { id: 'docker', name: 'Docker 一键命令' },
  { id: 'compose', name: 'Docker Compose' },
  { id: 'shell', name: 'Shell 脚本' },
]

const availableTemplates = ref([])

async function loadTemplates() {
  try {
    const data = await request('/api/v1/templates')
    if (Array.isArray(data)) availableTemplates.value = data
  } catch (e) {
    console.error('Failed to load templates', e)
  }
}

function getTemplateProtocol(templateId) {
  const t = availableTemplates.value.find(item => item.id === templateId)
  return t ? t.protocol : 'vless'
}

function addSlot(targetForm) {
  if (!targetForm.inbounds) targetForm.inbounds = []
  const defaultTpl = availableTemplates.value[0]
  targetForm.inbounds.push({
    template_id: defaultTpl ? defaultTpl.id : 1,
    listen_port: 2096,
    hop_ports: '',
    enabled: 1
  })
}

function removeSlot(targetForm, idx) {
  if (targetForm.inbounds) {
    targetForm.inbounds.splice(idx, 1)
  }
}

const addForm = reactive({
  owner_id: null,
  name: '',
  server_ip: '',
  proxy_port: 443,
  hop_ports: '',
  inbounds: []
})

const dockerRunCommand = computed(() => {
  const masterUrl = `${window.location.protocol}//${customMasterHost.value.trim() || window.location.host}`
  const token = activeInstructionNode.value?.token || ""
  return `docker run -d \\
  --name sm-node \\
  --restart always \\
  --net host \\
  -v ./data:/var/lib/sm-ui \\
  -e MASTER_URL="${masterUrl}" \\
  -e NODE_TOKEN="${token}" \\
  ghcr.io/akkunyo/sm-node:latest`
})

const dockerComposeSnippet = computed(() => {
  const masterUrl = `${window.location.protocol}//${customMasterHost.value.trim() || window.location.host}`
  const token = activeInstructionNode.value?.token || ""
  return `services:
  sm-node:
    image: ghcr.io/akkunyo/sm-node:latest
    container_name: sm-node
    restart: always
    network_mode: "host"
    environment:
      - MASTER_URL=${masterUrl}
      - NODE_TOKEN=${token}
    volumes:
      - ./data:/var/lib/sm-ui`
})

const shellCommand = computed(() => {
  const masterUrl = `${window.location.protocol}//${customMasterHost.value.trim() || window.location.host}`
  const token = activeInstructionNode.value?.token || ""
  return `curl -fsSL https://raw.githubusercontent.com/AkkunYo/sm-ui-worker/main/scripts/install.sh | \\
  MASTER_URL="${masterUrl}" \\
  NODE_TOKEN="${token}" \\
  bash`
})


async function toggleNodePower(node) {
  togglingId.value = node.id
  const nextStatus = node.status === 'disabled' ? 'online' : 'disabled'
  try {
    await request(`/api/v1/nodes/${node.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: nextStatus
      })
    })
    await loadNodes()
  } catch (err) {
    alert(err.message || '更新主机状态失败')
  } finally {
    togglingId.value = null
  }
}

function displayCoreVersion(version) {
  if (!version || version === 'latest') return '—'
  return `v${version.replace(/^v/, '')}`
}

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}
function openAddModal() {
  addForm.name = ''
  addForm.server_ip = ''
  addForm.proxy_port = 443
  addForm.hop_ports = ''
  addForm.owner_id = currentUser.value?.id || null
  addForm.inbounds = availableTemplates.value.map(t => ({
    template_id: t.id,
    listen_port: 2096,
    hop_ports: '',
    enabled: 1
  }))
  showAddModal.value = true
}

function openInstructionModal(node) {
  activeInstructionNode.value = node

  // Find Master local node
  const master = nodes.value.find(n => n.is_local)

  // Auto detect scheme
  joinScheme.value = window.location.protocol === 'https:' ? 'wss' : 'ws'

  // Auto detect host
  let bestHost = window.location.host
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (master && master.server_ip && master.server_ip !== '127.0.0.1' && master.server_ip !== 'localhost') {
      const port = window.location.port || '3000'
      bestHost = `${master.server_ip}:${port}`
    }
  }

  detectedMasterHost.value = bestHost
  customMasterHost.value = bestHost
  activeTab.value = 'docker'
  copiedTab.value = ''
  showInstructionModal.value = true
}

async function loadNodes() {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  const revision = nodeRevision
  try {
    const url = selectedTenantFilter.value ? `/api/v1/nodes?owner_id=${selectedTenantFilter.value}` : '/api/v1/nodes'
    const data = await readPage(url)
    if (!Array.isArray(data)) throw new Error('主机列表响应无效')
    if (nodeRevision === revision) nodes.value = data
    loaded.value = true

    if (isAdmin.value && tenantList.value.length === 0) {
      const usersData = await request('/api/v1/users').catch(() => [])
      if (Array.isArray(usersData)) tenantList.value = usersData
    }
  } catch (err) {
    if (err.name !== 'AbortError' && nodeRevision === revision) loadError.value = err.message || '加载主机列表失败'
  } finally {
    loading.value = false
  }
}

async function createNode() {
  try {
    const res = await request('/api/v1/nodes', {
      method: 'POST',
      body: JSON.stringify(addForm)
    })
    const nodeObj = res.node || res
    if (nodeObj && (nodeObj.token || nodeObj.id)) {
      showAddModal.value = false
      activeInstructionNode.value = nodeObj
      openInstructionModal(nodeObj)
      await loadNodes()
    }
  } catch (err) {
    alert(err.message || '创建节点失败')
  }
}

async function deleteNode(id) {
  if (!confirm('确定要删除此接入主机吗？该主机的长连隧道将中断。')) return
  try {
    await request(`/api/v1/nodes/${id}`, { method: 'DELETE' })
    await loadNodes()
  } catch (err) {
    alert(err.message || '删除主机失败')
  }
}

function copyCommand(text, tabId) {
  navigator.clipboard.writeText(text)
  copiedTab.value = tabId
  setTimeout(() => {
    if (copiedTab.value === tabId) {
      copiedTab.value = ''
    }
  }, 2000)
}

const showEditModal = ref(false)
const savingEdit = ref(false)
const editForm = reactive({
  id: null,
  name: '',
  server_ip: '',
  proxy_port: 443,
  hop_ports: '',
  token: '',
  is_local: false,
  inbounds: []
})

function openEditModal(node) {
  editForm.id = node.id
  editForm.name = node.name
  editForm.server_ip = node.server_ip || ''
  editForm.proxy_port = node.proxy_port || 443
  editForm.hop_ports = node.hop_ports || ''
  editForm.token = node.token || ''
  editForm.is_local = Boolean(node.is_local)
  editForm.inbounds = Array.isArray(node.inbounds) && node.inbounds.length > 0
    ? node.inbounds.map(s => ({
        template_id: s.template_id,
        listen_port: s.listen_port,
        hop_ports: s.hop_ports || '',
        enabled: s.enabled !== 0 ? 1 : 0
      }))
    : availableTemplates.value.map(t => ({
        template_id: t.id,
        listen_port: 2096,
        hop_ports: '',
        enabled: 1
      }))
  showEditModal.value = true
}

async function saveEditNode() {
  savingEdit.value = true
  try {
    const payload = {
      name: editForm.name,
      server_ip: editForm.server_ip,
      proxy_port: editForm.proxy_port,
      hop_ports: editForm.hop_ports,
      inbounds: editForm.inbounds
    }
    const res = await request(`/api/v1/nodes/${editForm.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    })
    showEditModal.value = false
    await loadNodes()
    alert('主机配置已保存并立即生效！')
  } catch (err) {
    alert(err.message || '保存主机配置失败')
  } finally {
    savingEdit.value = false
  }
}

onMounted(() => {
  loadNodes()
  loadTemplates()
})
</script>
