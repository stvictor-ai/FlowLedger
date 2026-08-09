# 投记 · 个人投资记账与资产追踪

## 项目概述
个人投资记账与资产追踪工具。以"统一净值视角"为核心：出入金记账提供成本与已实现盈亏，持仓按实时行情估值提供未实现盈亏，合并算出真实净值与真实收益率（真实总收益 = 已出金 + 当前持仓市值 − 已入金）。支持沪深市、美股、港股、加密货币、基金、黄金、期货等资产类型，覆盖记录管理、持仓追踪、盈亏统计、行为分析、复盘建议、数据备份与云同步。轻量静态应用，可直接部署。

## 技术栈
- `index.html` 为 Vue 主应用，纯计算逻辑可逐步拆到 `js/`，无需构建工具
- Vue 3（CDN）、Chart.js（CDN）、SheetJS/xlsx（CDN）、Day.js（CDN）
- 数据存储：浏览器 localStorage
- 云同步：GitHub Gist API（Bearer Token 认证，免费、带版本历史）
- PWA：`manifest.json` + `sw.js` + 图标资源
- 三主题现代财富工作台 UI，桌面端左侧工作台 + 平板横向 Tab + 手机端底部 Tab

## 文件结构
```
touji/
├── index.html      # Vue 主应用与界面
├── js/
│   ├── entry-engine.js  # 时间排序、逐笔换汇和人民币折算（UMD）
│   └── review-engine.js # 纯函数复盘引擎（UMD）
├── tests/
│   ├── entry-engine.test.js # 时间与换汇计算测试
│   └── review-engine.test.js # Node 内置测试
├── docs/plans/     # 功能实施计划
├── manifest.json   # PWA 配置
├── sw.js           # Service Worker 离线缓存
├── icon-192.png    # PWA 图标
├── icon-512.png    # PWA 图标
├── icon.svg        # 图标源文件
├── deploy.sh       # 阿里云部署脚本（已废弃，推荐 Gist 同步）
├── README.md       # 用户向说明
├── CLAUDE.md       # 本文件
```

## 已实现功能

### 核心功能
- [x] 出入金记录 CRUD（表格内直接编辑，无需弹窗）
- [x] 流水记录支持具体到分钟，同日记录按日期和时间排序
- [x] USD / HKD / USDT 入金支持逐笔实际汇率、人民币支付金额和到账数量
- [x] 当前汇率可自动拉取，也可手动覆盖，历史记录按成交时汇率固化
- [x] 快速录入（复制上一笔、交易所下拉补全、输入校验）
- [x] 标签系统（记录标签、标签筛选、标签盈亏统计、导入导出）
- [x] 盈亏规则：出金总额 > 入金总额 → 盈利
- [x] 空账本启动，可按需加载演示数据

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
- [x] 交易复盘日历（历史月份、每日操作、规则信号、每日笔记）
- [x] 近期行为时间线，规则信号关联到具体流水
- [x] 纯本地可解释规则：大额资金、FOMO、亏损卖出、密集买入、持仓集中
- [x] 复盘规则引擎从 `index.html` 拆分为可独立测试的 UMD 模块
- [x] 复盘清单（checkbox）
- [x] 周期复盘笔记
- [x] 近期复盘窗口（近 30/90/180 天、今年）
- [x] 雾白 / 岩灰 / 墨金主题切换并持久化
- [x] 现代财富工作台视觉系统（桌面侧栏、重点收益区、移动端底栏）
- [x] 投记专属 SVG / PWA 图标与全端统一线性导航图标
- [x] 桌面、平板和手机端紧凑主题菜单
- [x] 页面、菜单和提示轻量动效，并支持 `prefers-reduced-motion`
- [x] 阈值规则可配置：亏损提醒、强提醒、回收率、入金速度倍数、大额阈值、连续亏损周期

### 数据管理
- [x] Excel 导出（5 个 Sheet：入金/出金/流水/统计/月度）
- [x] Excel 导入（支持多 Sheet 格式 + 中文列名映射 + 导入预览）
- [x] JSON 备份/导入（导入预览 + 合并/覆盖确认）
- [x] 重复记录检测：完全重复跳过，JSON 同 ID 记录按更新处理
- [x] 导入历史：保留最近 20 次导入批次，支持撤销合并导入 / 恢复覆盖导入前账本
- [x] 完整快照（流水、持仓、删除记录，最多 6 份）+ 手动快照 + 一键恢复

### GitHub Gist 云同步
- [x] GitHub Personal Access Token 认证（仅需 gist scope）
- [x] 首次上传自动创建 Private Gist，后续自动发现并关联
- [x] 流水与持仓统一拉取/上传/双向合并，按 `updatedAt` 和删除墓碑解决冲突
- [x] 启动时自动静默拉取最新数据
- [x] Gist 天然版本历史，可回溯恢复

### 响应式布局
- [x] 桌面端（>1180px）：固定左侧工作台，每次只显示一个功能模块
- [x] 平板（760-1180px）：顶部横向工作区 Tab
- [x] 手机端（<760px）：固定底部工作区 Tab，录入使用完整快速录入模块
- [x] 手机端记录详情页（折合 CNY、同平台/同资产汇总、相关记录）
- [x] 390px 手机与 1280×720 矮屏桌面适配，无导航撑高和头部操作区遮挡

## 部署方式
- **本地使用**：直接浏览器打开 index.html
- **GitHub Pages**：直接部署，配合 Gist 同步实现多端数据共享
- **Netlify / Vercel**：直接拖拽 index.html 部署
- **服务器部署**：运行 deploy.sh（已不推荐）

## 数据模型
```javascript
// localStorage key: touji_entries_v1
// 兼容迁移旧版数据 key
[{
  id,           // UUID
  date,         // "YYYY-MM-DD"
  time,         // "HH:mm"，旧记录可为空
  amount,       // 原始金额，数字
  rate,         // 对 CNY 汇率，数字或空
  exchange,     // 账户/平台名称
  note,         // 备注
  type,         // "入金" | "出金" | "买入" | "卖出"
  assetType,    // "沪深市" | "美股" | "港股" | "加密货币" | "基金" | "黄金" | "期货" | "其他" | ""
  currency,     // "CNY" | "USD" | "HKD" | "USDT"
  tags,         // 行为标签数组，如 ["定投", "补仓", "FOMO"]
  sourceAmount, sourceCurrency, // 换汇支付侧，例如 500 CNY
  targetAmount, targetCurrency, // 换汇到账侧，例如 74.183976 USDT
  fxRate,       // 本笔实际成交汇率
  tradeQty, tradePrice, targetSymbol, targetName, targetMarket,
  positionId, realizedPL, updatedAt
}]

// 持仓 key: touji_positions_v1
// 流水删除墓碑 key: touji_deleted_v1
// 持仓删除墓碑 key: touji_position_deleted_v1
// 导入历史 key: touji_import_batches_v1
// 每日复盘笔记 key: touji_review_day_notes_v1
```

## 待办 / 可优化项
- [ ] 链上数据自动导入（钱包地址 / 交易所 API 对接）
- [ ] 多语言 i18n（至少中英文）
- [ ] 税务报告导出（部分地区 crypto 需报税）
- [x] 持仓追踪与买卖交易联动
- [x] 复盘引擎单元测试（`node --test tests/review-engine.test.js`）
- [ ] 为净值、持仓成本、导入与同步补齐单元测试和 E2E 测试
- [ ] 数据可视化 Dashboard 自定义
- [x] 手机端体验进一步打磨（卡片式记录列表替代表格横滚）
- [x] 图表可视化（月度趋势折线图，Chart.js）
- [x] 同步设置面板默认折叠，减少首屏干扰
- [x] 全端统一快速录入，避免重复入口
- [x] GitHub Gist 多端同步
