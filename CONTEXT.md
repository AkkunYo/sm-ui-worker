# SM-UI Worker 全局上下文记忆与架构备忘

## 1. 项目演进与定位 (Evolution & Philosophy)
本项目源自 `sm-ui`（基于 Go 单二进制的多 VPS SingBox 矩阵管理系统），进化为 **Cloudflare Workers + D1 架构的 100% Serverless 代理矩阵控制面**。
- **解决痛点**：传统面板（如 3x-ui）必须租用常驻服务器运行 Master，易发生单点故障、IP 被封、续费成本高。
- **新形态**：Master 控制面 100% 运行于 Cloudflare 边缘运行时，零服务器租金，自带全球 Anycast 高可用、顶级 DDoS 盾与免费 SSL。

## 2. 核心架构设计 (Architecture)
1. **控制面 (Master)**：
   - 框架：TypeScript + Hono
   - 存储：Cloudflare D1 (分布式边缘 SQLite)
   - 静态资源：Workers Static Assets 托管 Vue 3 仪表盘（SPA 路由降级）
2. **主从通信 (方案 A: HTTP Pull Sync 轮询拉取)**：
   - 各 VPS 节点运行轻量 Go 守护进程 (`agent/sm-node v2.1.0`)；
   - 默认每 30 秒向 Master 发送 `POST /api/v2/node/sync`，上报状态、延迟、CPU、内存、Uptime 以及用户流量消耗增量；
   - **单节点配置 Hash 判定**：Master 只按该节点自身配置内容的哈希 (`desired_config_hash`) 判定是否下发，修改其他租户或节点不会让本节点重载；
   - **租户级 Reality 密钥隔离**：每个租户独立一对 X25519 密钥，节点只收到所属租户的私钥；
   - **Agent 状态持久化与回滚**：本地持久化 `agent-state.json`（待确认流量批次、期望状态、失败配置哈希与 10 分钟重试冷却）。应用新配置时先停止旧核心再启动新配置，经约 3 秒健康检查确认存活；启动失败则恢复并重启上一份配置，整个过程约 3~8 秒；
   - **幂等流量收据**：流量批次按 `(node_id, batch_id)` 原子结算，重复提交只计一次；不属于节点所属租户的流量记录会被丢弃并记日志，批次照常确认出队，不会阻断配置下发。
   - **版本一致**：`package.json` 的 `version` 是唯一版本来源，Worker (`src/version.ts`) 与 Agent (`scripts/build-agent.sh` 注入) 使用同一版本号；发布 tag 必须等于 `v<version>`。
   - **优势**：无状态，规避 WebSocket 挂载时间限制，完全运行在 Cloudflare 免费版额度内，容错率极高。
3. **多协议与端口跳跃**：
   - 节点标准监听 2096/TCP (VLESS Reality) 与 2096/UDP (Hysteria 2)；
   - Hysteria 2 端口跳跃依赖 VPS 上手工配置的 UDP 端口范围转发（iptables/nftables），项目只负责在订阅中输出跳跃端口，不管理转发规则；
4. **全客户端自适应通用订阅**：
   - 访问 `/sub/:username/:token` 或 `/sub/:token`，自动嗅探 User-Agent 或显式 `format=clash|singbox|base64`：
     - Mihomo / Clash: YAML 配置 (含分流规则与 url-test 自动选线)
     - Sing-box 1.11+: 官方原生 JSON 配置 (Hysteria 2 跳跃使用 `server_ports`，该字段自 1.11.0 起支持)
     - 通用客户端: Base64 聚合链接 (兼容 NekoBox `mport` 规范)
   - 附带 `Subscription-Userinfo` 头部，客户端实时显示已用与总流量。

## 3. 代码库结构 (Codebase)
- **根目录**：
  - `wrangler.jsonc`: Cloudflare Worker 配置文件，声明 D1 绑定 `DB` (`sm-ui-db`) 与静态目录 `./web/dist`
  - `schema.sql`: D1 SQLite 数据库表定义 (`system_settings`, `users`, `nodes`, `inbound_templates`)
  - `package.json` / `tsconfig.json`: Root Worker 工程配置
- **`src/` (Worker 后端)**：
  - `index.ts`: Hono REST API 路由、Scheme A 同步接口、JWT 鉴权、各资源 CRUD、`/sub/:token` 订阅下发
  - `keys.ts`: 基于 `@noble/curves` 的 RFC 7748 X25519 Reality 密钥对生成与 Token 生成
  - `protocol.ts`: Sing-box 服务端完整配置生成器
  - `subscription.ts`: 多格式订阅生成器
  - `db.ts`: D1 数据库初始化与常用查询
- **`web/` (Vue 3 前端)**：
  - 路由：`/setup` (首次引导设置), `/` (仪表盘), `/nodes` (节点主机管理), `/inbounds` (协议模板), `/users` (用户管理), `/settings` (管理员密码)
  - 核心交互：
    - 主机列表左置电源开关图标（Power），实时控制停用/启用；
    - 地址列眼睛图标（Eye）一键对全表 IP 模糊脱敏；
    - 采集并展示系统真实 Uptime 运行时长；
    - 入站模板提供 11 个推荐 SNI 预设弹窗（Amazon、Apple、Cloudflare 等），密钥与 Hy2 默认内置驱动；
    - 用户 ID 1 锁定为系统初始管理员，前后端双重拦截防误删；已用流量紧凑展示为 `0 B / 无限制`。
- **`agent/` (VPS 节点端)**：
  - `main.go` / `core.go` / `state.go`: Go 编写的单二进制节点客户端，实现 HTTP Pull、进程守护、健康检查、安全回滚、系统指标采集
  - `Dockerfile`: 多架构 Docker 镜像构建，预装带 `with_v2ray_api` 标签的官方 `sing-box v1.14.2`
- **`scripts/install.sh`**: 原生 Linux Systemd 一键安装脚本
- **`.github/workflows/release.yml`**: GitHub Actions 流水线，编译多架构二进制并推送 `ghcr.io/akkunyo/sm-node`

## 4. 远程仓库与作者规范
- **仓库地址**：`https://github.com/AkkunYo/sm-ui-worker`
- **Git 规范**：全仓库严格遵循 Conventional Commits，作者及提交者统一为 `AkkunYo <945395054@qq.com>`，杜绝任何 Bot 或第三方污染。

## 5. Cloudflare 部署步骤
1. 在 Cloudflare 控制台创建 D1 数据库 `sm-ui-db`，在 Console 中执行 `schema.sql` 建表。
2. 在 Workers & Pages 中绑定 GitHub 仓库 `AkkunYo/sm-ui-worker`，构建命令填 `npm run build`。
3. 添加 D1 绑定：Variable 填 `DB`，对应数据库选择 `sm-ui-db`。
4. 部署后访问分配的 Worker 域名即可进入使用。
