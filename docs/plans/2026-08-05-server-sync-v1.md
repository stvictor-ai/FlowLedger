# Server Sync v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为投记增加邀请制账号、PostgreSQL 持久化和不覆盖本地数据的多设备同步。

**Architecture:** 新增独立的 Node.js 模块化单体 API，通过 PostgreSQL 保存用户、邀请、会话、账本、流水和持仓。现有静态前端继续以 localStorage 为主，在用户登录并确认迁移后通过 revision 乐观锁同步。

**Tech Stack:** Node.js、Express、PostgreSQL、`pg`、Argon2id、Docker Compose、Node 内置测试运行器。

---

### Task 1: 后端工程与运行环境

**Files:**
- Create: `server/package.json`
- Create: `server/src/app.js`
- Create: `server/src/config.js`
- Create: `server/src/server.js`
- Create: `server/test/health.test.js`
- Create: `.env.example`
- Create: `docker-compose.yml`

**Steps:**

1. 编写健康检查测试，要求 `GET /api/v1/health` 返回 API 状态。
2. 运行 `node --test server/test/health.test.js`，确认测试因应用不存在而失败。
3. 实现不直接监听端口的 `createApp()`，并在 `server.js` 中启动。
4. 增加环境变量校验，生产环境缺少数据库地址或会话密钥时拒绝启动。
5. 配置 API 与 PostgreSQL 的 Docker Compose 服务，数据库端口不映射到公网。
6. 安装依赖并运行测试，预期健康检查通过。

### Task 2: 数据库迁移与访问层

**Files:**
- Create: `server/migrations/001_initial.sql`
- Create: `server/src/db/pool.js`
- Create: `server/src/db/migrate.js`
- Create: `server/test/migrations.test.js`

**Steps:**

1. 编写迁移测试，验证 users、invitation_codes、sessions、ledgers、entries、positions 表和关键唯一索引存在。
2. 创建带事务的迁移执行器和 `schema_migrations` 表。
3. 编写初始 SQL，所有业务表使用 UUID 主键并设置外键级联规则。
4. 为 `users.email`、`ledgers(user_id)` 和记录所属关系建立索引。
5. 运行迁移测试并确认重复执行迁移不会报错。

### Task 3: 邀请制注册与安全会话

**Files:**
- Create: `server/src/modules/auth/routes.js`
- Create: `server/src/modules/auth/service.js`
- Create: `server/src/modules/auth/repository.js`
- Create: `server/src/modules/auth/password.js`
- Create: `server/src/modules/auth/session.js`
- Create: `server/src/modules/invitations/service.js`
- Create: `server/scripts/create-invite.js`
- Create: `server/test/auth.test.js`

**Steps:**

1. 编写注册失败测试：无邀请码、过期邀请码、重复邮箱和弱密码。
2. 编写注册成功测试，确认密码和邀请码均不以明文入库。
3. 实现邮箱规范化、Argon2id 密码哈希和邀请次数事务扣减。
4. 编写登录测试，确认错误凭证返回统一响应。
5. 实现随机会话令牌、数据库哈希存储和安全 Cookie。
6. 编写退出和 `/api/v1/auth/me` 测试。
7. 实现管理脚本，命令行生成一次或多次使用的邀请码。
8. 加入认证接口限流和 Origin 校验测试。

### Task 4: 账本与 revision 同步 API

**Files:**
- Create: `server/src/modules/ledgers/routes.js`
- Create: `server/src/modules/ledgers/repository.js`
- Create: `server/src/modules/sync/routes.js`
- Create: `server/src/modules/sync/service.js`
- Create: `server/src/modules/sync/repository.js`
- Create: `server/test/sync.test.js`

**Steps:**

1. 编写首次注册自动创建默认账本的测试。
2. 编写读取账本快照测试，验证只返回当前用户数据。
3. 编写跨用户访问测试，预期返回 404。
4. 编写 revision 相同时提交成功的测试。
5. 编写旧 revision 提交返回 `409 REVISION_CONFLICT` 的测试。
6. 在数据库事务中锁定账本、校验版本、写入流水/持仓/删除状态并递增 revision。
7. 加入 10MB 请求限制、最大记录数和 payload 基础结构校验。
8. 运行并发同步测试，确认只有一个写入成功。

### Task 5: 前端服务器账号与首次迁移

**Files:**
- Create: `js/server-sync.js`
- Create: `tests/server-sync.test.js`
- Modify: `index.html`

**Steps:**

1. 为服务器同步客户端编写请求、revision 冲突和数据摘要单元测试。
2. 实现同源 API 客户端，所有请求使用 Cookie，不保存访问 Token。
3. 在“同步数据”工作台新增服务器账号入口，保留现有 Gist 面板。
4. 增加注册、登录和退出界面。
5. 登录后检测本地与远端数据，显示“上传本地 / 下载远端 / 暂不迁移”选择。
6. 调用现有快照方法后再执行迁移。
7. 发生 409 时重新拉取并展示差异，禁止静默覆盖。
8. 在 1440px、820px 和 390px 视口检查登录与迁移界面。

### Task 6: 部署、备份与运维验证

**Files:**
- Create: `ops/Caddyfile`
- Create: `ops/backup.sh`
- Create: `ops/restore.sh`
- Create: `ops/deploy.md`
- Modify: `README.md`
- Modify: `.gitignore`

**Steps:**

1. 配置 HTTPS 反向代理，只公开 80/443。
2. 编写 `pg_dump` 加密备份脚本，备份目标和密钥从环境变量读取。
3. 编写显式目标数据库的恢复脚本，并要求交互确认。
4. 在本地临时数据库执行一次备份和恢复演练。
5. 文档记录 DNS、防火墙、环境变量、创建首个邀请码和回退步骤。
6. 更新 README，说明服务器同步为可选功能，Gist 仍然可用。
7. 在 AWS 部署前核对系统版本、Docker、磁盘、域名和 SSH 访问方式。

### Task 7: 完整验收

**Files:**
- Modify: `server/test/*.test.js`
- Modify: `tests/*.test.js`

**Steps:**

1. 运行现有前端核心测试，确保导入与复盘没有回归。
2. 运行后端单元和数据库集成测试。
3. 用两个浏览器会话验证用户隔离与多设备 revision 冲突。
4. 验证退出服务器账号后仍可使用本地账本和 Gist。
5. 检查仓库不包含 `.env`、数据库文件、备份、真实邮箱、邀请码、Token 或个人账本。
6. 创建发布前快照并记录最终验证结果。

