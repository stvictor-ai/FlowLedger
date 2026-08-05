# 投记服务器同步 v1 设计

## 背景

投记当前是本地优先的静态应用，流水、持仓、复盘和同步配置存放在浏览器 `localStorage`，可选使用用户自己的 Private Gist 在设备间同步。这个方案适合个人使用，但不具备账号体系、用户隔离、邀请测试和统一的数据备份能力。

服务器同步 v1 的目标是在不破坏现有本地账本和 Gist 同步的前提下，增加邀请制多用户、PostgreSQL 持久化和安全的多设备同步。

## 已确认需求

- 第一阶段采用邀请制多用户，不开放自由注册。
- 用户使用邮箱、密码和邀请码注册，之后使用邮箱和密码登录。
- 首次登录检测本地数据，由用户明确选择上传本地账本、下载服务器账本或暂不迁移。
- 上传、下载和合并前创建本地快照，并展示双方记录数与金额摘要。
- 继续保留 `localStorage` 离线能力、JSON/Excel 备份和 Gist 同步，服务器功能作为新增选项。
- 正式环境使用一台 AWS，另一台用于测试与加密备份。
- 先服务小规模邀请用户，目标不超过 100 个账号和每个账本 10,000 条流水。

## 总体架构

```text
浏览器 / PWA
  ├── localStorage（离线账本与本地快照）
  └── HTTPS /api/v1
          ↓
反向代理（Caddy 或 Nginx）
          ↓
Node.js 模块化单体
  ├── auth         注册、登录、退出、会话
  ├── invitations  邀请码管理
  ├── ledgers      账本归属与版本
  └── sync         快照读取、乐观并发与合并
          ↓
PostgreSQL
```

前端与 API 使用同一域名。PostgreSQL 只在 Docker 内部网络监听，不向公网开放。浏览器登录状态使用安全 Cookie，不在 JavaScript 或 `localStorage` 中保存服务器访问令牌。

## 数据模型

### users

- `id`: UUID
- `email`: 规范化邮箱，唯一索引
- `password_hash`: Argon2id 哈希
- `status`: `active` 或 `disabled`
- `created_at`, `updated_at`

### invitation_codes

- `id`: UUID
- `code_hash`: 邀请码哈希，不保存明文
- `max_uses`, `used_count`
- `expires_at`, `disabled_at`
- `created_by`, `created_at`

### sessions

- `id`: UUID
- `user_id`
- `token_hash`: 随机会话令牌的哈希
- `expires_at`, `created_at`, `last_seen_at`

### ledgers

- `id`: UUID
- `user_id`: 所属用户
- `name`
- `revision`: 服务器单调递增版本号
- `created_at`, `updated_at`

### entries / positions

流水和持仓分别保存为独立记录。业务字段存入 `payload JSONB`，同时保留 `id`、`ledger_id`、`client_updated_at`、`deleted_at` 和服务器时间。这样可以兼容现有数据模型，同时为后续查询和结构迁移保留空间。

## 同步协议

1. 客户端读取服务器账本快照，得到 `revision`。
2. 客户端使用现有合并规则计算本地与服务器差异，并向用户展示预览。
3. 客户端提交完整合并结果和 `baseRevision`。
4. 服务端在数据库事务中锁定账本行。
5. 若当前 `revision` 与 `baseRevision` 不一致，返回 `409 REVISION_CONFLICT`，不写入任何数据。
6. 客户端重新拉取、再次合并并由用户确认。
7. 写入成功后服务端递增 `revision` 并返回新版本。

该方案不依赖设备时钟决定最终写入顺序。现有每条记录的 `updatedAt` 仍用于客户端展示差异，但服务器用账本 revision 防止并发覆盖。

## 身份与安全

- 密码最少 10 位，使用 Argon2id 哈希。
- 会话令牌由密码学安全随机数生成，数据库只保存令牌哈希。
- Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Lax`。
- API 不开放通配 CORS；修改请求校验 `Origin`。
- 登录与注册接口限流，错误信息不透露邮箱是否存在。
- 邀请码通过管理脚本生成，第一版不建设管理员后台。
- 所有查询必须同时限定 `user_id` 和 `ledger_id`，避免跨用户读取。
- 日志不记录密码、邀请码、Cookie、账本正文和真实 Token。

## 迁移与回退

- 登录不会自动上传或下载。
- 检测到本地账本时显示迁移选择页。
- 任何服务器同步前都先调用现有快照机制。
- 服务器模式使用独立配置键，不删除 Gist 配置。
- 用户可退出服务器账号并继续使用本地模式。
- 新功能发布前不修改 GitHub Pages 正式入口；稳定后再配置个人域名。

## 部署与备份

- Docker Compose 管理反向代理、API 和 PostgreSQL。
- 公网只开放 80/443；SSH 限制来源并使用密钥登录。
- PostgreSQL 使用持久化卷，部署过程不覆盖数据卷。
- 每日执行 `pg_dump`，加密后传输到第二台 AWS。
- 保留 7 个每日备份和 4 个每周备份；发布数据库迁移前额外备份。
- 每月至少进行一次恢复演练。
- 目标 RPO 为 24 小时、RTO 为 4 小时；浏览器本地副本作为额外恢复来源。

## 非功能目标

- 邀请测试期支持 100 个账号。
- 普通 API 在同区域网络下 p95 响应时间小于 500ms。
- 单次同步请求上限 10MB，并对记录数量做服务端校验。
- 服务可用性目标 99%，不为第一版建设多区域高可用。
- 健康检查区分 API 存活和数据库可用状态。

## 暂不包含

- 公开注册、邮件验证、验证码登录和自动找回密码。
- 社交登录、付费订阅和管理员网页后台。
- 双主数据库、微服务、Redis、消息队列和 Kubernetes。
- 服务端行情计算、投资建议或跨用户数据分析。
- 端到端加密。第一版依赖服务器磁盘与备份加密，服务端可读取账本数据。

## 验收标准

- 邀请码只能在有效期和可用次数内注册账号。
- 不同用户无法读取或修改彼此账本。
- 登录 Cookie 不暴露给前端 JavaScript。
- 两个设备并发写入时旧 revision 被拒绝，不会静默覆盖。
- 本地已有数据只有在用户确认后才上传。
- 数据库重建后可从第二台服务器备份恢复。

