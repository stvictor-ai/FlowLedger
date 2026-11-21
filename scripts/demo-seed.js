// Invented ledger for screenshots and visual checks. Paste into the page
// (or pass to scripts/browse.mjs --pre) to fill localStorage; nothing here is
// from a real account. Set __TAB__ before running to choose the workspace.
(() => {
  const mk = (type, amount, date, platform, asset, note, tags = [], extra = {}) => ({
    id: Math.random().toString(36).slice(2), type, amount, currency: 'CNY', date, time: '10:30',
    platform, exchange: platform, assetType: asset, note, tags,
    updatedAt: new Date(date + 'T10:30:00').getTime(), ...extra,
  });
  const put = (amount, date, platform, asset, note, tags, fundSource) => mk('入金', amount, date, platform, asset, note, tags, { fundSource });
  const take = (amount, date, platform, asset, note, tags) => mk('出金', amount, date, platform, asset, note, tags, { destination: 'card' });
  const rows = [
    put(30000, '2025-11-08', '招商证券', '沪深市', '', ['定投'], 'savings'),
    put(18000, '2025-12-15', '欧易', '加密货币', '', ['定投'], 'salary'),
    take(9000, '2026-01-20', '招商证券', '沪深市', '', ['止盈']),
    put(25000, '2026-02-11', '欧易', '加密货币', '', ['补仓'], 'savings'),
    put(12000, '2026-03-05', '天天基金', '基金', '', ['定投'], 'salary'),
    take(15000, '2026-04-18', '欧易', '加密货币', '卖掉一部分', ['止盈']),
    put(20000, '2026-05-22', '招商证券', '沪深市', '', ['定投'], 'salary'),
    put(8000, '2026-06-30', '天天基金', '基金', '', ['定投'], 'salary'),
    take(11000, '2026-07-14', '招商证券', '沪深市', '换到基金', ['调仓']),
    put(16000, '2026-08-09', '欧易', '加密货币', '', ['定投'], 'salary'),
    put(9000, '2026-09-02', '天天基金', '基金', '', ['定投'], 'salary'),
    put(6000, '2026-10-12', '天天基金', '基金', '', ['定投'], 'salary'),
    put(5000, '2026-11-10', '招商证券', '沪深市', '', ['定投'], 'salary'),
    put(3000, '2026-11-18', '欧易', '加密货币', '', ['补仓'], 'salary'),
  ];
  // 每个账户「现在值多少」，首页的盈亏按它算。
  const today = '2026-11-20';
  const balance = (account, value) => ({ id: `balance:${account}`, kind: 'balance', account, value, asOf: today, history: [{ date: today, value }], updatedAt: new Date(today + 'T20:00:00').getTime() });
  const balances = [balance('招商证券', 38650), balance('欧易', 52480), balance('天天基金', 36210)];
  const stamp = new Date('2026-09-02T10:30:00').getTime();
  const positions = [
    { updatedAt: stamp, id: 'd1', symbol: '510300', name: '沪深300ETF', qty: 12000, avgCost: 3.82, currency: 'CNY', assetType: '沪深市', source: 'eastmoney', secid: '1.510300' },
    { updatedAt: stamp, id: 'd2', symbol: 'BTC', name: '比特币', qty: 0.42, avgCost: 268000, currency: 'CNY', assetType: '加密货币' },
    { updatedAt: stamp, id: 'd3', symbol: '110011', name: '易方达中小盘', qty: 8600, avgCost: 2.14, currency: 'CNY', assetType: '基金' },
  ];
  localStorage.setItem('touji_entries_v1', JSON.stringify(rows));
  localStorage.setItem('touji_positions_v1', JSON.stringify(positions));
  localStorage.setItem('touji_debts_v1', JSON.stringify(balances));
  localStorage.setItem('touji_rules_v1', JSON.stringify({ monthlyCap: 10000 }));
  localStorage.setItem('touji_active_tab_v1', window.__TAB__ || 'overview');
  localStorage.setItem('touji_lang_v1', 'zh');
  location.reload();
})();
