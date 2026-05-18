# FlowLedger 投记 · 个人投资记账

## 项目概述
个人全渠道投资出入金管理工具，支持大A、美股、港股、加密货币、基金、黄金、期货等资产类型，覆盖记录管理、盈亏统计、行为分析、复盘建议、数据备份与云同步。单文件 HTML 应用，可静态部署。

## 技术栈
- **单文件 `index.html`**（约 1800 行），无需构建工具
- Vue 3（CDN）、Chart.js（CDN）、SheetJS/xlsx（CDN）、Day.js（CDN）
- 数据存储：浏览器 localStorage
- 云同步：Basic Auth + Express server（`deploy.sh` 含服务端代码）
- PWA：`manifest.json` + `sw.js` + 图标资源
- 深色金融风 UI，桌面端宽布局 + 手机端底部 Tab

## 文件结构
```
CryptoFlow/
├── index.html      # 主应用（前端全部代码）
├── manifest.json   # PWA 配置
├── sw.js           # Service Worker 离线缓存
├── icon-192.png    # PWA 图标
├── icon-512.png    # PWA 图标
├── icon.svg        # 图标源文件
├── deploy.sh       # 阿里云一键部署脚本（含 nginx 配置 + Node.js 同步服务）
├── README.md       # 用户向说明
├── CLAUDE.md       # 本文件
```

## 已实现功能

### 核心功能
- [x] 出入金记录 CRUD（表格内直接编辑，无需弹窗）
- [x] 快速录入（复制上一笔、交易所下拉补全、输入校验）
- [x] 标签系统（记录标签、标签筛选、标签盈亏统计、导入导出）
- [x] 盈亏规则：出金总额 > 入金总额 → 盈利
- [x] 预置 50 条真实历史数据（首次打开即有内容）

### 统计与分析
- [x] 总览指标：总入金、总出金、净盈亏、回本比例
- [x] 周/月/年盈亏统计（含累计盈亏列）
- [x] 交易所维度统计
- [x] 标签维度统计
- [x] 周期对比（当前 vs 上期 + 环比变化）
- [x] 大额出入金提醒（阈值可配置）

### 筛选系统
- [x] 按月份、类型、关键词、日期区间、金额区间、交易所、资产类型、标签筛选
- [x] 命中高亮，未命中变淡（不隐藏）
- [x] 一键定位第一条命中记录

### 复盘与建议
- [x] 自动生成周期建议（基于 6 条阈值规则）
- [x] 复盘清单（checkbox）
- [x] 周期复盘笔记
- [x] 阈值规则可配置：亏损提醒、强提醒、回收率、入金速度倍数、大额阈值、连续亏损周期

### 数据管理
- [x] Excel 导出（5 个 Sheet：入金/出金/流水/统计/月度）
- [x] Excel 导入（支持多 Sheet 格式 + 中文列名映射 + 导入预览）
- [x] JSON 备份/导入（导入预览 + 合并/覆盖确认）
- [x] 重复记录检测：完全重复默认跳过，疑似重复需显式选择
- [x] 导入历史：保留最近 20 次导入批次，支持撤销合并导入 / 恢复覆盖导入前账本
- [x] 自动快照（最多 10 份 FIFO）+ 手动快照 + 一键恢复

### 云同步
- [x] Basic Auth 认证（兼容 Codex 版 server.js）
- [x] 上传/拉取按钮 + 状态显示
- [x] 服务端：Express + 文件存储（在 deploy.sh 中）

### 响应式布局
- [x] 桌面端（>860px）：长页面滚动，统计+建议并排双栏，表格内编辑
- [x] 平板（680-860px）：单栏宽表格
- [x] 手机端（<680px）：底部 Tab 切换 + 浮动添加按钮 + 弹出式 Modal
- [x] 手机端记录详情页（折合 CNY、同平台/同资产汇总、相关记录）

## 部署方式
- **本地使用**：直接浏览器打开 index.html
- **服务器部署**：运行 deploy.sh（需 nginx + Node.js + pm2）
- **Netlify**：直接拖拽 index.html 部署

## 数据模型
```javascript
// localStorage key: flowledger_entries_v1
// 兼容迁移旧 key: crypto_cashflow_entries_v1
[{
  id,           // UUID
  date,         // "YYYY-MM-DD"
  amount,       // 原始金额，数字
  rate,         // 对 CNY 汇率，数字或空
  exchange,     // 账户/平台名称
  note,         // 备注
  type,         // "入金" | "出金"
  assetType,    // "大A" | "美股" | "港股" | "加密货币" | "基金" | "黄金" | "期货" | "其他" | ""
  currency,     // "CNY" | "USD" | "HKD" | "USDT"
  tags          // 行为标签数组，如 ["定投", "补仓", "FOMO"]
}]

// 导入历史 key: flowledger_import_batches_v1
// 用于记录每次 Excel/JSON 导入批次，支持一键撤销。
```

## 参考项目
之前用 Codex 做过一版，在 `/Users/swings/Desktop/New project/`（原生 JS 版本）。当前版本融合了两版优点：
- 从 Codex 版借鉴：长页面滚动、表格内编辑、并排布局、预置数据、5Sheet 导出、累计盈亏、Basic Auth 同步
- 自有优势：Vue 3 响应式、深色金融风 UI、手机端适配

## 待办 / 可优化项
- [ ] 阿里云服务器实际部署（deploy.sh 已写好，未执行）
- [ ] 部署后验证云同步功能
- [x] 手机端体验进一步打磨（卡片式记录列表替代表格横滚）
- [x] 图表可视化（月度趋势折线图，Chart.js）
- [x] 同步设置面板默认折叠，减少首屏干扰
- [x] 手机端隐藏内联录入表单，仅保留 FAB+Modal 入口
- [ ] HTTPS 配置（如果绑定域名）
