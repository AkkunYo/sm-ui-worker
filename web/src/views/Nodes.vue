<template>
  <div class="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white">节点主机管理 (Node Hosts)</h1>
        <p class="text-xs sm:text-sm text-slate-400 mt-0.5">管理通过反向 WSS 长连接入的 VPS 主机实例与专属凭证</p>
      </div>
      <button
        @click="openAddModal"
        class="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/20 self-start sm:self-auto shrink-0"
      >
        <Plus class="w-4 h-4" />
        <span>添加接入主机</span>
      </button>
    </div>

    <div v-if="loadError" role="alert" class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs sm:text-sm text-rose-300">
      {{ loadError }}<span v-if="loaded">，当前展示上次成功获取的数据。</span>
      <button type="button" :disabled="loading" @click="loadNodes" class="ml-3 underline disabled:opacity-50">重试</button>
    </div>
    <PageSkeleton v-if="!loaded && !loadError" label="正在加载主机列表…" />

    <!-- Tenant Filter (Admin Only) -->
    <div v-if="isAdmin && tenantList.length > 0" class="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl text-xs">
      <div class="flex items-center space-x-2 text-slate-300">
        <Users class="w-4 h-4 text-violet-400" />
        <span class="font-medium">筛选租户主机:</span>
        <select v-model="selectedTenantFilter" @change="loadNodes" class="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none">
          <option value="">全部租户主机 ({{ nodes.length }}台)</option>
          <option v-for="t in tenantList" :key="t.id" :value="t.id">{{ t.username }} ({{ t.node_count || 0 }}台)</option>
        </select>
      </div>
      <span class="text-[11px] text-slate-500 font-mono">多租户强隔离</span>
    </div>

    <!-- High Density Nodes Table -->
    <div v-if="loaded" class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs sm:text-sm text-slate-300">
          <thead class="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800 select-none">
            <tr>
              <th class="px-4 py-3 font-semibold">名称 / 状态</th>
              <th v-if="isAdmin" class="px-3 py-3 font-semibold">租户</th>
              <th class="px-4 py-3 font-semibold">
                <div class="flex items-center space-x-1.5">
                  <span>出口地址 / 延迟</span>
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
              <th class="px-4 py-3 font-semibold">挂载协议模板</th>
              <th class="px-4 py-3 font-semibold">资源负载</th>
              <th class="px-3 py-3 font-semibold">运行时长 / 版本</th>
              <th class="px-4 py-3 font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80">
            <tr v-if="nodes.length === 0">
              <td :colspan="isAdmin ? 7 : 6" class="px-6 py-12 text-center text-slate-500">
                暂无接入主机，点击右上角“添加接入主机”生成专属 UUID 与一键纳管指令。
              </td>
            </tr>
            <tr v-for="node in nodes" :key="node.id" class="hover:bg-slate-800/30 transition">
              <!-- 1. Name & Status -->
              <td class="px-4 py-3 min-w-[140px]">
                <div class="flex items-center space-x-2">
                  <span class="relative flex h-2 w-2 shrink-0">
                    <span
                      v-if="node.status === 'online'"
                      class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                    ></span>
                    <span
                      :class="node.status === 'online' ? 'bg-emerald-500' : 'bg-rose-500'"
                      class="relative inline-flex rounded-full h-2 w-2"
                    ></span>
                  </span>
                  <span class="font-medium text-white text-xs sm:text-sm truncate" :title="node.name">{{ node.name }}</span>
                  <span
                    v-if="node.is_local"
                    class="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 shrink-0"
                  >Master</span>
                </div>
                <p v-if="node.core_error" :title="node.core_error" class="text-[10px] text-amber-300 max-w-44 truncate mt-0.5">{{ node.core_error }}</p>
                <p v-if="node.last_error" :title="node.last_error" class="text-[10px] text-rose-300 max-w-44 truncate mt-0.5">{{ node.last_error }}</p>
              </td>

              <!-- Owner Tag (Admin Only) -->
              <td v-if="isAdmin" class="px-3 py-3">
                <span class="px-2 py-0.5 rounded text-[11px] font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20 whitespace-nowrap">
                  {{ node.owner_username || 'Admin' }}
                </span>
              </td>

              <!-- 2. Address & Latency -->
              <td class="px-4 py-3">
                <div class="flex items-center space-x-2 font-mono text-xs">
                  <span :class="hideAddresses ? 'filter blur-[4.5px] select-none transition-all duration-200 text-slate-200' : 'text-slate-200'">
                    {{ node.server_ip || (node.is_local ? '本机 Master' : '待接入') }}
                  </span>
                  <span
                    v-if="node.status === 'online'"
                    class="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap"
                  >
                    {{ node.rtt_ms || 0 }} ms
                  </span>
                  <span
                    v-else-if="node.status === 'disabled'"
                    class="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-800 text-slate-500 whitespace-nowrap"
                  >
                    已停用
                  </span>
                  <span
                    v-else
                    class="px-1.5 py-0.2 rounded text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 whitespace-nowrap"
                  >
                    离线
                  </span>
                </div>
              </td>

              <!-- 3. Inbound Slots Badges -->
              <td class="px-4 py-3">
                <div v-if="node.inbounds && node.inbounds.length > 0" class="flex flex-wrap items-center gap-1">
                  <span
                    v-for="slot in node.inbounds"
                    :key="slot.id || slot.template_id"
                    class="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex items-center gap-1"
                    :class="slot.enabled === 0
                      ? 'bg-slate-800/60 text-slate-500 border border-slate-700/50 line-through'
                      : slot.protocol === 'vless'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : slot.protocol === 'hysteria2'
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : slot.protocol === 'tuic'
                            ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                            : slot.protocol === 'trojan'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'"
                  >
                    <span>{{ slot.protocol ? slot.protocol.toUpperCase() : 'SLOT' }}:{{ slot.listen_port }}</span>
                    <span v-if="slot.hy2_obfs_password" class="text-[9px] text-amber-300/80">🛡Obfs</span>
                  </span>
                </div>
                <span v-else class="text-xs text-slate-600">—</span>
              </td>

              <!-- 4. Resources (CPU & Memory) -->
              <td class="px-4 py-3">
                <div class="space-y-1 w-28 text-[11px] font-mono text-slate-400">
                  <div class="flex justify-between text-[10px]">
                    <span>C:{{ node.cpu_percent ? node.cpu_percent.toFixed(0) : 0 }}%</span>
                    <span>M:{{ node.memory_percent ? node.memory_percent.toFixed(0) : 0 }}%</span>
                  </div>
                  <div class="w-full bg-slate-800 rounded-full h-1 overflow-hidden flex">
                    <div
                      class="bg-emerald-500 h-1 transition-all"
                      :style="{ width: `${Math.min(node.cpu_percent || 0, 100)}%` }"
                    ></div>
                  </div>
                </div>
              </td>

              <!-- 5. Uptime & Agent Version -->
              <td class="px-3 py-3 font-mono text-xs text-slate-400">
                <div>{{ formatUptime(node.uptime_seconds) }}</div>
                <div class="text-[10px] text-slate-500 mt-0.5">
                  {{ node.agent_version ? `v${node.agent_version.replace(/^v/, '')}` : '—' }}
                </div>
              </td>

              <!-- 6. Right Actions -->
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end space-x-1.5">
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
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 1. Add Node Modal -->
    <Teleport to="body">
      <div v-if="showAddModal" @click.self="showAddModal = false" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-white">添加接入主机</h2>
            <p class="text-xs text-slate-400 mt-0.5">分配主机 UUID 凭证与 WSS 长连接入地址</p>
          </div>
          <button @click="showAddModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>

        <form @submit.prevent="createNode" class="space-y-4">
          <div v-if="isAdmin && tenantList.length > 0">
            <label for="node-add-owner" class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              指定所属租户用户
            </label>
            <select
              id="node-add-owner"
              v-model="addForm.owner_id"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option v-for="t in tenantList" :key="t.id" :value="t.id">{{ t.username }} ({{ t.role === 'admin' ? '超管' : '租户' }})</option>
            </select>
            <p class="text-[11px] text-slate-500 mt-1">选中的租户将独占纳管该主机</p>
          </div>

          <div>
            <label for="node-add-name" class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              主机备注名称 <span class="text-rose-400">* (不得重复)</span>
            </label>
            <input
              id="node-add-name"
              v-model="addForm.name"
              type="text"
              required
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="例如: US01 / 香港BGP"
            />
            <p class="text-[11px] text-slate-500 mt-1">订阅节点名格式形如“<code class="text-emerald-400 font-mono">备注名-IP</code>”</p>
          </div>

          <div>
            <label for="node-add-server-ip" class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              指定公网出口 IP 或域名 (可选)
            </label>
            <input
              id="node-add-server-ip"
              v-model="addForm.server_ip"
              type="text"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:border-emerald-500 focus:outline-none font-mono"
              placeholder="留空则在子节点连接时自动识别（推荐）"
            />
          </div>

          <!-- Inbound Templates Multi-Select Dropdown -->
          <div class="space-y-1.5 pt-2 border-t border-slate-800">
            <div class="flex items-center justify-between">
              <span id="node-add-templates-label" class="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
                挂载协议模板 (多选)
              </span>
              <span class="text-[11px] text-slate-500 font-mono">
                已选 {{ addForm.template_ids.length }} / {{ availableTemplates.length }}
              </span>
            </div>

            <div class="relative">
              <button
                type="button"
                @click="addDropdownOpen = !addDropdownOpen"
                :aria-expanded="addDropdownOpen"
                aria-controls="node-add-templates-menu"
                aria-labelledby="node-add-templates-label node-add-templates-selected"
                class="w-full text-left min-h-[42px] px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 focus:outline-none cursor-pointer flex items-center justify-between gap-2 flex-wrap"
              >
                <span id="node-add-templates-selected" class="flex items-center gap-1.5 flex-wrap">
                  <span v-if="addForm.template_ids.length === 0" class="text-xs text-slate-500">
                    请选择挂载协议模板...
                  </span>
                  <span
                    v-for="tid in addForm.template_ids"
                    :key="tid"
                    class="px-2 py-0.5 rounded text-[11px] font-mono font-medium border"
                    :class="getProtoBadge(getTemplateById(tid)?.protocol).class"
                  >
                    {{ getTemplateById(tid)?.protocol?.toUpperCase() || 'SLOT' }}
                  </span>
                </span>
                <ChevronDown aria-hidden="true" class="w-4 h-4 text-slate-400 shrink-0 transition-transform" :class="addDropdownOpen ? 'rotate-180' : ''" />
              </button>

              <div
                v-if="addDropdownOpen"
                id="node-add-templates-menu"
                role="group"
                aria-labelledby="node-add-templates-label"
                class="absolute left-0 right-0 top-full mt-1.5 z-50 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-1.5 max-h-48 overflow-y-auto space-y-1"
              >
                <label
                  v-for="t in availableTemplates"
                  :key="t.id"
                  class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer text-xs"
                >
                  <div class="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      :value="t.id"
                      v-model="addForm.template_ids"
                      class="rounded bg-slate-950 border-slate-700 text-emerald-500 w-4 h-4 focus:ring-0"
                    />
                    <span class="font-mono font-bold text-slate-200">{{ t.protocol.toUpperCase() }}</span>
                    <span class="font-mono text-slate-500">:{{ t.listen_port }}</span>
                  </div>
                  <span class="text-[11px] text-slate-400 truncate max-w-[140px]">{{ t.name }}</span>
                </label>
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
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center space-x-2">
              <h2 class="text-lg font-bold text-white">主机专属部署指令</h2>
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {{ activeInstructionNode?.name || '新主机' }}
              </span>
            </div>
            <p class="text-xs text-slate-400 mt-0.5">在目标 VPS 执行以下命令，容器启动后自动长连接入</p>
          </div>
          <button @click="showInstructionModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Master Endpoint Config in Modal -->
        <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-300">Master 接入公网地址：</span>
            <div class="flex items-center space-x-3">
              <label class="flex items-center space-x-1 text-slate-300 cursor-pointer">
                <input type="radio" value="wss" v-model="joinScheme" class="accent-emerald-500" />
                <span>WSS (TLS)</span>
              </label>
              <label class="flex items-center space-x-1 text-slate-300 cursor-pointer">
                <input type="radio" value="ws" v-model="joinScheme" class="accent-emerald-500" />
                <span>WS (明文)</span>
              </label>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <input
              v-model="customMasterHost"
              type="text"
              class="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              placeholder="例如: 203.0.113.10:3000 或 panel.example.com"
            />
            <button
              v-if="detectedMasterHost && customMasterHost !== detectedMasterHost"
              @click="customMasterHost = detectedMasterHost"
              type="button"
              class="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition whitespace-nowrap"
              title="还原为自动探测地址"
            >
              还原探测
            </button>
          </div>
        </div>

        <!-- Pinned Permanent WSS (JOIN_URL) -->
        <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
          <div class="flex justify-between items-center text-xs">
            <span class="text-slate-400 font-medium">专属 WSS 接入链接：</span>
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
            class="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-emerald-400 focus:outline-none select-all font-medium"
          />
        </div>

        <!-- Mode Tabs -->
        <div class="flex space-x-2 border-b border-slate-800 pb-2">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="px-3 py-1 rounded-lg text-xs font-medium transition"
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
            <span>创建 docker-compose.yml 并执行 docker compose up -d：</span>
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

        <div class="flex justify-end pt-2">
          <button
            @click="showInstructionModal = false"
            class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs sm:text-sm transition"
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
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-white flex items-center space-x-2">
              <span>主机属性配置</span>
              <span v-if="editForm.is_local" class="px-2 py-0.5 rounded text-xs bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">本机 Master</span>
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">修改该 VPS 主机的备注名称与挂载协议</p>
          </div>
          <button @click="showEditModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>

        <form @submit.prevent="saveEditNode" class="space-y-4">
          <div>
            <label for="node-edit-name" class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              主机备注名称 <span class="text-rose-400">*</span>
            </label>
            <input
              id="node-edit-name"
              v-model="editForm.name"
              type="text"
              required
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="例如: US01 / 香港BGP / Master"
            />
          </div>

          <div>
            <label for="node-edit-server-ip" class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              指定公网出口 IP 或域名 (可选)
            </label>
            <input
              id="node-edit-server-ip"
              v-model="editForm.server_ip"
              type="text"
              class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="留空则自动识别使用（多 IP 逗号隔开）"
            />
          </div>

          <!-- Inbound Templates Multi-Select Dropdown for Edit Modal -->
          <div class="space-y-1.5 pt-2 border-t border-slate-800">
            <div class="flex items-center justify-between">
              <span id="node-edit-templates-label" class="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
                挂载协议模板 (多选)
              </span>
              <span class="text-[11px] text-slate-500 font-mono">
                已选 {{ editForm.template_ids.length }} / {{ availableTemplates.length }}
              </span>
            </div>

            <div class="relative">
              <button
                type="button"
                @click="editDropdownOpen = !editDropdownOpen"
                :aria-expanded="editDropdownOpen"
                aria-controls="node-edit-templates-menu"
                aria-labelledby="node-edit-templates-label node-edit-templates-selected"
                class="w-full text-left min-h-[42px] px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 focus:outline-none cursor-pointer flex items-center justify-between gap-2 flex-wrap"
              >
                <span id="node-edit-templates-selected" class="flex items-center gap-1.5 flex-wrap">
                  <span v-if="editForm.template_ids.length === 0" class="text-xs text-slate-500">
                    请选择挂载协议模板...
                  </span>
                  <span
                    v-for="tid in editForm.template_ids"
                    :key="tid"
                    class="px-2 py-0.5 rounded text-[11px] font-mono font-medium border"
                    :class="getProtoBadge(getTemplateById(tid)?.protocol).class"
                  >
                    {{ getTemplateById(tid)?.protocol?.toUpperCase() || 'SLOT' }}
                  </span>
                </span>
                <ChevronDown aria-hidden="true" class="w-4 h-4 text-slate-400 shrink-0 transition-transform" :class="editDropdownOpen ? 'rotate-180' : ''" />
              </button>

              <div
                v-if="editDropdownOpen"
                id="node-edit-templates-menu"
                role="group"
                aria-labelledby="node-edit-templates-label"
                class="absolute left-0 right-0 top-full mt-1.5 z-50 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-1.5 max-h-48 overflow-y-auto space-y-1"
              >
                <label
                  v-for="t in availableTemplates"
                  :key="t.id"
                  class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer text-xs"
                >
                  <div class="flex items-center space-x-2.5">
                    <input
                      type="checkbox"
                      :value="t.id"
                      v-model="editForm.template_ids"
                      class="rounded bg-slate-950 border-slate-700 text-emerald-500 w-4 h-4 focus:ring-0"
                    />
                    <span class="font-mono font-bold text-slate-200">{{ t.protocol.toUpperCase() }}</span>
                    <span class="font-mono text-slate-500">:{{ t.listen_port }}</span>
                  </div>
                  <span class="text-[11px] text-slate-400 truncate max-w-[140px]">{{ t.name }}</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label for="node-edit-token" class="block text-xs font-semibold text-slate-400 mb-1">主机专属 HostId 凭证</label>
            <input
              id="node-edit-token"
              type="text"
              readonly
              :value="editForm.token"
              class="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-400 select-all focus:outline-none"
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
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus, Trash2, X, Copy, Terminal, Check, Sliders, Power, Eye, EyeOff, Users, ChevronDown } from 'lucide-vue-next'
import { request, getUser } from '../api'
import { appVersion } from '../router'
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
const addDropdownOpen = ref(false)
const editDropdownOpen = ref(false)

function getTemplateById(id) {
  return availableTemplates.value.find(t => t.id === id)
}

async function loadTemplates() {
  try {
    const data = await request('/api/v1/templates')
    if (Array.isArray(data)) availableTemplates.value = data
  } catch (e) {
    console.error('Failed to load templates', e)
  }
}

function getProtoBadge(proto) {
  switch (proto) {
    case 'vless': return { label: 'VLESS', class: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
    case 'hysteria2': return { label: 'Hy2', class: 'bg-sky-500/15 text-sky-300 border-sky-500/30' }
    case 'tuic': return { label: 'TUIC', class: 'bg-violet-500/15 text-violet-300 border-violet-500/30' }
    case 'trojan': return { label: 'Trojan', class: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
    case 'anytls': return { label: 'AnyTLS', class: 'bg-rose-500/15 text-rose-300 border-rose-500/30' }
    default: return { label: proto, class: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
  }
}

const addForm = reactive({
  owner_id: null,
  name: '',
  server_ip: '',
  template_ids: []
})

const dockerRunCommand = computed(() => {
  const masterUrl = `${window.location.protocol}//${customMasterHost.value.trim() || window.location.host}`
  const token = activeInstructionNode.value?.token || ''
  return `docker run -d \\
  --name sm-node \\
  --restart always \\
  --net host \\
  -v ./data:/var/lib/sm-ui \\
  -e MASTER_URL="${masterUrl}" \\
  -e NODE_TOKEN="${token}" \\
  ghcr.io/akkunyo/sm-node:${appVersion.value}`
})

const dockerComposeSnippet = computed(() => {
  const masterUrl = `${window.location.protocol}//${customMasterHost.value.trim() || window.location.host}`
  const token = activeInstructionNode.value?.token || ''
  return `services:
  sm-node:
    image: ghcr.io/akkunyo/sm-node:${appVersion.value}
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
  const token = activeInstructionNode.value?.token || ''
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
  addDropdownOpen.value = false
  addForm.name = ''
  addForm.server_ip = ''
  addForm.owner_id = currentUser.value?.id || null
  addForm.template_ids = availableTemplates.value.filter(t => t.is_default).map(t => t.id)
  showAddModal.value = true
}

function openInstructionModal(node) {
  activeInstructionNode.value = node
  const master = nodes.value.find(n => n.is_local)
  joinScheme.value = window.location.protocol === 'https:' ? 'wss' : 'ws'
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
  token: '',
  is_local: false,
  template_ids: []
})

function openEditModal(node) {
  editDropdownOpen.value = false
  editForm.id = node.id
  editForm.name = node.name
  editForm.server_ip = node.server_ip || ''
  editForm.token = node.token || ''
  editForm.is_local = Boolean(node.is_local)
  editForm.template_ids = Array.isArray(node.inbounds) && node.inbounds.length > 0
    ? node.inbounds.filter(s => s.enabled !== 0).map(s => s.template_id)
    : availableTemplates.value.filter(t => t.is_default).map(t => t.id)
  showEditModal.value = true
}

async function saveEditNode() {
  savingEdit.value = true
  try {
    const payload = {
      name: editForm.name,
      server_ip: editForm.server_ip,
      template_ids: editForm.template_ids
    }
    await request(`/api/v1/nodes/${editForm.id}`, {
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
