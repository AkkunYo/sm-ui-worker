# SM-UI Worker 全局上下文记忆与架构备忘

## 1. 项目演进与定位 (Evolution & Philosophy)
本项目源自 `sm-ui`（基于 Go 单二进制的多 VPS SingBox 矩阵管理系统），进化为 **Cloudflare Workers + D1 架构的 100% Serverless 代理矩阵控制面**。
- **解决痛点**：传统面板（如 3x-ui）必须租用常驻服务器运行 Master，易发生单点故障、IP 被封、续费成本高。
- **新形态**：Master 控制面 100% 运行于 Cloudflare 边缘运行时，零服务器租金，自带全球 Anycast 高可用、顶级 DDoS 盾与免费 SSL。

## 2. 核心架构设计 (Architecture)
1. **控制面 (Master)**：TypeScript + Hono；存储 Cloudflare D1 (`sm-ui-db`)；Workers Static Assets 托管 Vue 3 仪表盘（SPA 路由降级）。
2. **主从通信 (HTTP Pull 轮询)**：
   - 各 VPS 运行 Go 守护进程 `sm-node`，每 30 秒 `POST /api/v2/node/sync`（带 `X-Node-Token`），上报状态、RTT、CPU、内存、Uptime、`agent_version`、自签证书指纹与流量批次（单次最多 8 批）；
   - **单节点配置哈希**：Master 只按该节点自身配置内容的哈希判定是否下发，修改其他租户或节点不会让本节点重载；
   - **租户级 Reality 密钥隔离**：每个租户独立一对 X25519 密钥，节点只收到所属租户的私钥；
   - **Agent 状态持久化与回滚**：本地 `agent-state.json` 保存待确认流量批次、期望状态、已应用哈希与失败配置哈希（10 分钟重试冷却）。应用新配置时先停旧核心、再启新配置并做约 3 秒健康检查，失败则恢复上一份配置；
   - **幂等流量收据**：流量批次按 `(node_id, batch_id)` 原子结算，重复提交只计一次；不属于节点所属租户的流量会被丢弃并记日志，批次照常确认出队。
3. **协议与端口模型**：
   - **1 个主模板 = 1 种协议 = 1 个端口**，不做端口跳跃；端口与参数只由管理员在主模板中修改，主机（含租户）只能勾选挂载哪些模板；
   - 支持 VLESS Reality、Hysteria 2（可选 Salamander 混淆）、TUIC v5、Trojan Reality、AnyTLS；初始化默认模板为 `VLESS Reality` 与 `Hysteria 2`，均为 2096（TCP/UDP 共用）；
   - Hy2 / TUIC / AnyTLS 使用节点自签证书 `certs/selfsigned.crt`，agent 上报其 DER 的 SHA-256 用于订阅锁定。
4. **全客户端自适应订阅**：`/sub/:username/:token`（或 `/sub/:token`），嗅探 User-Agent 或显式 `format=clash|singbox|base64`；附带 `Subscription-Userinfo` 头。证书锁定按客户端能力区分：
   - Clash / Mihomo：`fingerprint`（`skip-cert-verify` 保持 true，mihomo 设了 fingerprint 就只按哈希校验）；
   - 通用链接：`pinSHA256` / `pcs`，不带 `allowInsecure`（新版 Xray 已拒绝）；`tuic://` 额外带 `allow_insecure=1`（NekoBox 只认这个参数名）；
   - Sing-box JSON：保持 `insecure: true` 不锁定（NekoBox 内置 sing-box 1.12 不认识 `certificate_public_key_sha256`，且遇到未知字段会拒绝整个配置）。
5. **节点单二进制**：`sm-node` 内嵌 gzip 压缩的 sing-box 核心（`with_quic,with_utls,with_clash_api,with_v2ray_api`），启动时按 SHA-256 校验并释放到 `bin/sing-box`，作为子进程守护；`127.0.0.1:8080` 为 `v2ray_api` 流量统计端口，只监听本地回环。
6. **版本规则**：`package.json` 的 `version` 是唯一版本来源，格式 `<sing-box 版本>-<项目修订号>`（如 `1.14.3-1`）；sing-box 版本由此推导并注入核心（`sing-box version` 显示 `1.14.3`）。Git tag 与 Release 带 `v`（`v1.14.3-1`），镜像标签不带 `v`（`sm-node:1.14.3-1`）。Worker (`src/version.ts`) 与 agent 使用同一版本号。
7. **节点安装**：`install.sh` 默认安装最新 Release，`SM_NODE_VERSION` 仅在需要指定版本时传入；面板生成的 docker run / compose 命令写死总控当前版本，避免长期使用的 compose 静默换版本。

## 3. 发版与数据库变更 (Release & Migrations)
- **发版顺序**：改 `package.json` / `package-lock.json` / `src/version.ts` → 提交并推送 → 推 tag `v<version>` → CI（校验 tag 与版本格式 → 前端单元测试与浏览器测试 → 编译双架构二进制与 Release → 推送镜像）→ **CI 完成后**再部署 Worker（否则面板 docker 命令会指向尚未构建的镜像）→ 节点先灰度一台，确认后逐台升级。
- **数据库迁移**：结构变更写成 `migrations/NNNN_*.sql`，用 `wrangler d1 migrations apply sm-ui-db --remote` 执行（迁移记录表 `d1_migrations` 已补齐 0001–0009）。`schema.sql` 始终是最新完整结构，供全新安装使用。删除字段时先部署不再读写该字段的 Worker，确认心跳正常后再执行删列迁移。

## 4. 代码库结构 (Codebase)
- **根目录**：`wrangler.jsonc`（D1 绑定 `DB` → `sm-ui-db`，静态目录 `./web/dist`）、`schema.sql`、`migrations/`、`package.json`（唯一版本号）
- **`src/` (Worker 后端)**：
  - `index.ts`: Hono 入口，挂载 `routes/` 下的 auth、sync、nodes、templates、users、subscription 路由
  - `routes/sync.ts`: 节点同步、流量结算、证书指纹校验入库
  - `protocol.ts`: 服务端配置生成与订阅端点解析；`subscription.ts`: 三种订阅格式生成
  - `repo/inbounds.ts`: 节点挂载模板查询；`lib/`: 加密、模板权限、租户密钥；`keys.ts`: X25519 密钥与 Token 生成
  - `middleware/auth.ts`、`login-guard.ts`: JWT 鉴权与登录限流；`version.ts`: 版本号
- **`web/` (Vue 3 前端)**：
  - 路由：`/setup`、`/login`、`/`（仪表盘）、`/nodes`、`/inbounds`（协议模板）、`/subscription`、`/users`（租户管理）、`/settings`（账号设置）
  - 主机列表：电源开关、IP 脱敏、单一版本标签；主机弹窗以下拉多选挂载模板（只显示协议名）
  - 协议模板：紧凑表格，默认模板置顶，仅管理员可修改
  - 测试：`web/tests/api.test.js`（单元测试）、`web/tests/browser/`（Playwright 浏览器测试，CI 发版前执行）
- **`agent/` (节点端)**：`main.go`（同步循环、指标采集、看门狗）、`core.go`（核心进程守护、健康检查、回滚）、`state.go`（状态持久化）、`embed_singbox.go`（内嵌核心释放）、`Dockerfile`（alpine 基础镜像，只拷贝 CI 编好的 `sm-node`）
- **`scripts/`**：`install.sh`（Systemd 安装）、`build-agent.sh`（本地编译单二进制）、`prepare-deploy.js` / `validate-deploy-config.js`（生成并校验部署用 Wrangler 配置）
- **`.github/workflows/release.yml`**：推送 `v*` tag 时触发，见第 3 节发版顺序

## 5. 远程仓库与作者规范
- **仓库地址**：`https://github.com/AkkunYo/sm-ui-worker`（公开仓库）
- **Git 规范**：全仓库严格遵循 Conventional Commits，作者及提交者统一为 `AkkunYo <945395054@qq.com>`，杜绝任何 Bot 或第三方污染。

## 6. Cloudflare 部署步骤
1. 在 Cloudflare 控制台创建 D1 数据库 `sm-ui-db`，执行 `schema.sql` 建表（全新安装）。
2. 本地部署：`D1_DATABASE_ID=<数据库 ID> npm run deploy`（生成并校验 `.wrangler.generated.jsonc` 后发布；`wrangler.jsonc` 中的 `database_id` 保持占位符）。
3. 首次访问域名，按引导完成管理员初始化。
