# 投记 AWS 单机部署

本方案在一台 AWS 主机上运行 Caddy、Node API 和 PostgreSQL。Caddy 自动申请 HTTPS 证书，数据库只存在 Docker 内部网络；第二台 AWS 用于接收加密备份和做恢复演练。

## 1. 上线前准备

- 一台 Ubuntu 24.04 LTS 或同等级 Linux 主机，建议至少 2 vCPU、2 GB 内存和 20 GB 磁盘。
- 一个专用子域名，例如 `touji.example.com`，A 记录指向主服务器公网 IP。
- AWS Security Group 只开放 `22`、`80`、`443`。SSH 的 `22` 最好只允许自己的固定 IP。
- 安装 Docker Engine 与 Docker Compose plugin，确认 `docker compose version` 可用。
- 不要向公网开放 PostgreSQL 的 `5432` 端口。

## 2. 配置服务

```bash
git clone https://github.com/stvictor-ai/FlowLedger.git
cd FlowLedger
cp .env.example .env
openssl rand -hex 32
```

编辑 `.env`：

```dotenv
DOMAIN=touji.example.com
APP_ORIGIN=https://touji.example.com
ACCOUNT_ORIGIN=https://orbitshz.com
IDENTITY_PROVIDER=session
POSTGRES_DB=touji
POSTGRES_USER=touji
POSTGRES_PASSWORD=使用独立的长随机密码
DATABASE_URL=postgres://touji:上面同一个密码@db:5432/touji
SESSION_SECRET=openssl生成的至少32字符随机值
```

若域名接入个人站 Orbit 统一账号，将 `IDENTITY_PROVIDER` 改为 `orbit`，并在宿主机 Caddy 为投记站点配置 `forward_auth`，复制 `X-Orbit-User-Id`、`X-Orbit-User-Role`、`X-Orbit-User-Email` 三个响应头。此模式下投记自带注册/登录接口关闭，账号管理统一由个人站负责。

`.env` 已被 Git 忽略，不要提交，也不要截图分享。数据库密码如果包含 URL 特殊字符，需要在 `DATABASE_URL` 中进行百分号编码；最省事的做法是使用十六进制随机字符串。

## 3. 启动与检查

```bash
docker compose config
docker compose up -d --build
docker compose ps
curl -fsS https://touji.example.com/api/v1/health
curl -fsS https://touji.example.com/api/v1/health/ready
```

正常情况下，存活检查返回 `status: ok`，就绪检查返回 `status: ready`。首次启动会自动执行数据库迁移。

如果服务器已经由宿主机 Caddy 管理 80/443，只启动数据库和 API，并用覆盖文件把 API 映射到本机回环地址：

```bash
docker compose \
  -f docker-compose.yml \
  -f deploy/docker-compose.existing-caddy.yml \
  up -d --build db api
```

然后在宿主机 Caddy 的站点块中将 `/api/*` 反向代理到 `127.0.0.1:8787`。不要启动 Compose 中的 `web` 服务，否则会和已有 Caddy 争用 80/443。

查看日志：

```bash
docker compose logs --tail=100 api
docker compose logs --tail=100 web
docker compose logs --tail=100 db
```

## 4. 创建邀请码

默认邀请码可使用 1 次、14 天后过期：

```bash
docker compose exec api npm run invite:create
```

自定义次数和有效期：

```bash
docker compose exec \
  -e INVITE_MAX_USES=5 \
  -e INVITE_EXPIRES_DAYS=30 \
  api npm run invite:create
```

邀请码只会在终端显示一次。不要写进代码、README 或公开聊天记录。

## 5. 日常发布

发布前先备份，再更新代码：

```bash
./ops/backup-postgres.sh
git pull --ff-only
docker compose up -d --build
curl -fsS https://touji.example.com/api/v1/health/ready
```

`docker compose up -d --build` 不会删除 PostgreSQL 数据卷。不要执行 `docker compose down -v`，其中 `-v` 会删除数据库卷。

## 6. 备份到第二台 AWS

`ops/backup-postgres.sh` 使用 PostgreSQL custom dump，并在写入后执行结构校验。默认保存在仓库下的 `backups/`，该目录不会进入 Git。

推荐在第二台服务器创建 `age` 密钥，只把公钥放到主服务器：

```bash
AGE_RECIPIENT=age1xxxxxxxxxxxxxxxx ./ops/backup-postgres.sh
rsync -av --remove-source-files backups/*.age backup-user@backup-host:/srv/touji-backups/
```

可用 cron 每天凌晨执行。SSH 使用专用密钥，第二台服务器磁盘启用 AWS EBS 加密。建议保留 14 天日备份，并每月在第二台服务器做一次恢复演练。

## 7. 恢复演练

恢复会替换当前数据库，正式环境执行前先停止写入并再次备份：

```bash
CONFIRM_RESTORE=YES ./ops/restore-postgres.sh backups/touji-YYYYMMDDTHHMMSSZ.dump
curl -fsS https://touji.example.com/api/v1/health/ready
```

加密的 `.dump.age` 文件也可直接传给恢复脚本，脚本会调用本机 `age` 解密到临时文件。恢复后用测试账号核对流水数、持仓数和账本 revision。

## 8. 回退原则

- 前端发布异常：回退 Git 提交后重新执行 `docker compose up -d --build`，不动数据库卷。
- API 异常：先查看日志和就绪检查；数据库仍正常时只重建 `api` 服务。
- 数据库迁移异常：停止 API，使用发布前 dump 恢复，再回退代码。
- 服务器暂不可用：用户仍可在浏览器本地记账，恢复后通过“比较并同步”手动合并。
