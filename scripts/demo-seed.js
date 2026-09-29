// Invented ledger for screenshots and visual checks. Paste into the page
// (or pass to scripts/browse.mjs --pre) to fill localStorage; nothing here is
// from a real account. Set __TAB__ before running to choose the workspace.
(() => {
  const mk = (type, amount, date, platform, asset, note, tags = [], extra = {}) => ({
    id: Math.random().toString(36).slice(2), type, amount, currency: 'CNY', date, time: '10:30',
    platform, exchange: platform, assetType: asset, note, tags,
    updatedAt: new Date(date + 'T10:30:00').getTime(), ...extra,
  });
  const rows = [
    mk('入金', 30000, '2025-11-08', '招商证券', '沪深', '工资入金', ['工资入金']),
    mk('入金', 18000, '2025-12-15', '欧易', '加密货币', '定投', ['定投']),
    mk('出金', 9000, '2026-01-20', '招商证券', '沪深', '止盈', ['止盈']),
    mk('入金', 25000, '2026-02-11', '欧易', '加密货币', '补仓', ['补仓']),
    mk('入金', 12000, '2026-03-05', '天天基金', '基金', '定投', ['定投']),
    mk('出金', 15000, '2026-04-18', '欧易', '加密货币', '部分止盈', ['止盈']),
    mk('入金', 20000, '2026-05-22', '招商证券', '沪深', '定投', ['定投']),
    mk('入金', 8000, '2026-06-30', '天天基金', '基金', '定投', ['定投']),
    mk('出金', 11000, '2026-07-14', '招商证券', '沪深', '换仓', []),
    mk('入金', 16000, '2026-08-09', '欧易', '加密货币', '定投', ['定投']),
    mk('入金', 9000, '2026-09-02', '天天基金', '基金', '定投', ['定投']),
  ];
  const stamp = new Date('2026-09-02T10:30:00').getTime();
  const positions = [
    { updatedAt: stamp, id: 'd1', symbol: '510300', name: '沪深300ETF', qty: 12000, avgCost: 3.82, currency: 'CNY', assetType: '沪深', source: 'eastmoney', secid: '1.510300' },
    { updatedAt: stamp, id: 'd2', symbol: 'BTC', name: '比特币', qty: 0.42, avgCost: 268000, currency: 'CNY', assetType: '加密货币' },
    { updatedAt: stamp, id: 'd3', symbol: '110011', name: '易方达中小盘', qty: 8600, avgCost: 2.14, currency: 'CNY', assetType: '基金' },
  ];
  localStorage.setItem('touji_entries_v1', JSON.stringify(rows));
  localStorage.setItem('touji_positions_v1', JSON.stringify(positions));
  localStorage.setItem('touji_active_tab_v1', window.__TAB__ || 'overview');
  localStorage.setItem('touji_lang_v1', 'zh');
  location.reload();
})();
