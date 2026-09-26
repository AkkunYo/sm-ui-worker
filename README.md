<div align="center">
  <h1>⚡️ SM-UI Worker (SingBox Matrix Worker Edition)</h1>
  <p><strong>基于 Cloudflare Workers + D1 的无服务器（Serverless）多 VPS 代理矩阵管理系统</strong></p>
  <p>主控零服务器成本 · 全球 Anycast 边缘高可用 · 节点 HTTP Pull 轮询免长连 · 订阅全协议秒级分发</p>

  <p>
    <a href="https://github.com/AkkunYo/sm-ui-worker/actions/workflows/release.yml"><img src="https://github.com/AkkunYo/sm-ui-worker/actions/workflows/release.yml/badge.svg" alt="CI Status" /></a>
    <a href="https://github.com/AkkunYo/sm-ui-worker/releases"><img src="https://img.shields.io/github/v/release/AkkunYo/sm-ui-worker?color=emerald" alt="Release" /></a>
    <a href="https://github.com/AkkunYo/sm-ui-worker/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  </p>
</div>

---

## 🌟 核心架构设计

传统的 X-UI 或多节点面板需要租用一台常驻的 Master VPS 运行面板与数据库，存在**单点故障、易被封锁、服务器续费成本高**的问题。

**SM-UI Worker** 采用纯 Serverless 架构：
1. **控制面 (Master)**：100% 运行于 **Cloudflare Workers** 边缘运行时，搭配 **Cloudflare D1** (分布式边缘 SQLite) 与 **Workers Static Assets** 托管 Vue 3 仪表盘。**主控完全免费，永不掉线，自带免费 SSL 与 DDoS 盾。**
2. **通信协议 (方案 A: HTTP Pull)**：各 VPS 节点作为 Worker Node，每 10 秒向 Cloudflare Worker 发起一次轻量 HTTP 同步汇报负载（CPU/RAM/Uptime）。若管理后台下发了新配置，Node 原地拉取并热重载 sing-box。**无需 WebSocket 挂载，极致容错，完全跑在免费 Worker 额度内。**
3. **单端口双协议复用 (Port 443 Multiplexing)**：Node 边缘节点使用端口 443 同时分发 **VLESS-Reality (TCP)** 与 **Hysteria 2 (UDP)**。
4. **全客户端自适应订阅**：`/sub/:token` 走 Cloudflare Anycast 全球 CDN 边缘缓存，自动嗅探输出 Mihomo/Clash YAML、Sing-box JSON 及 Base64 URI。

---

## 🚀 部署指南 (Cloudflare Worker 主控)

### 方式一：Cloudflare Dashboard Git 绑定直连部署 (推荐，零运维)

1. **Fork 本仓库** 到你的 GitHub 账号。
2. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)：
   * 点击左侧 **Workers & Pages** -> **Create application** -> **Workers**。
   * 选择 **Connect to Git** 绑定刚刚 Fork 的 `sm-ui-worker` 仓库。
3. **创建与绑定 D1 数据库**：
   * 在 Cloudflare 控制台左侧点击 **D1 SQL Database** -> **Create database**，名称填 `sm-ui-db`。
   * 点击控制台中的 **Console**，粘贴项目中的 `schema.sql` 内容并点击 **Execute** 执行初始化建表。
   * 返回你的 Worker 项目 -> **Settings** -> **Bindings** -> 点击 **Add** -> 选择 **D1 database**：
     * **Variable name**：`DB`
     * **D1 database**：选择刚刚创建的 `sm-ui-db`
4. **点击 Save and Deploy**：Cloudflare 自动完成前端静态资源构建与 API 发布，获得专属主控域名（例如: `https://sm-ui-worker.yourname.workers.dev` 或自定义域名）。

---

### 方式二：本地 Wrangler 命令行部署

```bash
# 1. 克隆代码并安装依赖
git clone https://github.com/AkkunYo/sm-ui-worker.git
cd sm-ui-worker
npm install

# 2. 创建 Cloudflare D1 数据库
npx wrangler d1 create sm-ui-db
# 将终端输出的 database_id 替换到 wrangler.jsonc 中

# 3. 初始化数据库表结构
npx wrangler d1 execute sm-ui-db --remote --file=./schema.sql

# 4. 构建前端并发布到 Cloudflare
npm run deploy
```

---

## 🖥️ VPS 边缘节点接入 (Worker Nodes)

在控制台打开「节点主机 (Hosts)」-> 点击右上角「添加接入主机」，即可获得专属安装指令。

### 方式一：Docker 一键接入 (推荐)

在目标 VPS 终端执行：
```bash
docker run -d \
  --name sm-node \
  --restart always \
  --net host \
  -v ./data:/var/lib/sm-ui \
  -e MASTER_URL="https://sm-ui-worker.yourname.workers.dev" \
  -e NODE_TOKEN="<你的主机HostIdToken>" \
  ghcr.io/akkunyo/sm-node:latest
```

### 方式二：原生 Systemd 服务安装 (免 Docker)

```bash
curl -fsSL https://raw.githubusercontent.com/AkkunYo/sm-ui-worker/main/scripts/install.sh | \
  MASTER_URL="https://sm-ui-worker.yourname.workers.dev" \
  NODE_TOKEN="<你的主机HostIdToken>" \
  bash
```

启动后，VPS 节点将自动下载/就绪官方 `sing-box v1.11.4`，并在控制面板秒级亮起在线绿灯！

---

## 📄 开源许可证

本项目遵循 [MIT License](LICENSE) 开源协议。
