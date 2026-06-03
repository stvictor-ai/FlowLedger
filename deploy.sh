#!/bin/bash
# ============================================================
# 投记 一键部署脚本
# 使用方法：
#   1. 修改下面的配置项
#   2. scp deploy.sh 和 index.html 到服务器
#   3. chmod +x deploy.sh && ./deploy.sh
# ============================================================

set -e

# ========== 修改这里 ==========
SITE_PORT=8080          # 网站访问端口（避开已有服务）
SYNC_PORT=8787          # 同步服务端口（内部使用，不需要公网开放）
SYNC_USER="admin"       # 同步账号
SYNC_PASS="changeme123" # 同步密码（请修改！）
DOMAIN="_"              # 域名，没有就填 _
# ==============================

SITE_DIR="/var/www/touji"
SERVER_DIR="$SITE_DIR/server"

echo "========================================="
echo "  投记 部署开始"
echo "  网站端口: $SITE_PORT"
echo "  同步端口: $SYNC_PORT (内部)"
echo "========================================="

# ---------- 1. 创建目录 ----------
echo "[1/7] 创建目录..."
mkdir -p "$SITE_DIR"
mkdir -p "$SERVER_DIR/data"

# ---------- 2. 复制前端文件 ----------
echo "[2/7] 部署前端文件..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/index.html" ]; then
  cp "$SCRIPT_DIR/index.html" "$SITE_DIR/index.html"
  echo "  已复制 index.html"
else
  echo "  [警告] 同目录下未找到 index.html，请手动复制到 $SITE_DIR/"
fi

# ---------- 3. 创建同步服务 ----------
echo "[3/7] 创建同步服务..."

cat > "$SERVER_DIR/package.json" << 'PKGEOF'
{
  "name": "touji-sync",
  "type": "module",
  "dependencies": { "express": "^4.18.0" }
}
PKGEOF

cat > "$SERVER_DIR/server.js" << 'SRVEOF'
import express from "express";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "5mb" }));

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "sync.json");
const USERNAME = process.env.SYNC_USER || "admin";
const PASSWORD = process.env.SYNC_PASS || "changeme123";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const checkAuth = (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) return res.status(401).json({ error: "Unauthorized" });
  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const [user, pass] = decoded.split(":");
  if (user === USERNAME && pass === PASSWORD) return next();
  return res.status(401).json({ error: "Unauthorized" });
};

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/sync", checkAuth, (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.json({ updatedAt: null, entries: [] });
  try { return res.json(JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); }
  catch { return res.status(500).json({ error: "Corrupted data" }); }
});

app.post("/sync", checkAuth, (req, res) => {
  if (!Array.isArray(req.body?.entries)) return res.status(400).json({ error: "Invalid" });
  const data = { updatedAt: new Date().toISOString(), entries: req.body.entries };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  return res.json({ ok: true, updatedAt: data.updatedAt });
});

const port = process.env.PORT || 8787;
app.listen(port, "127.0.0.1", () => console.log(`sync server on ${port}`));
SRVEOF

# ---------- 4. 安装依赖 ----------
echo "[4/7] 安装 Node 依赖..."
cd "$SERVER_DIR"
npm install --production 2>&1 | tail -1

# ---------- 5. 配置 nginx ----------
echo "[5/7] 配置 nginx..."

cat > /etc/nginx/conf.d/touji.conf << NGXEOF
server {
    listen ${SITE_PORT};
    server_name ${DOMAIN};

    root ${SITE_DIR};
    index index.html;

    # 前端页面
    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    # 同步 API 反向代理
    location /sync {
        proxy_pass http://127.0.0.1:${SYNC_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:${SYNC_PORT};
    }
}
NGXEOF

# 检查 nginx 配置
nginx -t 2>&1 | tail -1

# ---------- 6. 启动同步服务 ----------
echo "[6/7] 启动同步服务..."

# 安装 pm2（如果没有）
if ! command -v pm2 &> /dev/null; then
  echo "  安装 pm2..."
  npm install -g pm2 2>&1 | tail -1
fi

# 停掉旧的（如果有）
pm2 delete touji-sync 2>/dev/null || true

# 启动
cd "$SERVER_DIR"
SYNC_USER="$SYNC_USER" SYNC_PASS="$SYNC_PASS" PORT="$SYNC_PORT" \
  pm2 start server.js --name touji-sync \
  --env SYNC_USER="$SYNC_USER" \
  --env SYNC_PASS="$SYNC_PASS" \
  --env PORT="$SYNC_PORT"

pm2 save --force 2>&1 | tail -1

# 设置开机自启（静默）
pm2 startup 2>/dev/null || true

# ---------- 7. 重载 nginx ----------
echo "[7/7] 重载 nginx..."
nginx -s reload

# ---------- 完成 ----------
echo ""
echo "========================================="
echo "  部署完成!"
echo "========================================="
echo ""
echo "  访问地址:  http://$(hostname -I | awk '{print $1}'):${SITE_PORT}"
echo ""
echo "  同步配置（在页面里填写）:"
echo "    服务器地址: http://$(hostname -I | awk '{print $1}'):${SITE_PORT}"
echo "    账号: ${SYNC_USER}"
echo "    密码: ${SYNC_PASS}"
echo ""
echo "  记得在阿里云控制台防火墙放行端口 ${SITE_PORT}"
echo ""
echo "  常用命令:"
echo "    pm2 logs touji-sync   # 查看同步服务日志"
echo "    pm2 restart touji-sync # 重启同步服务"
echo "    pm2 status                  # 查看服务状态"
echo "========================================="
