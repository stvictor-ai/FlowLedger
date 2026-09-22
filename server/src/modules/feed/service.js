import { isCashType, isTradeType, sortByMoment, summarise, toCashflow } from './cashflow.js'

const MAX_LIMIT = 2000

export function createFeedService({ repository, clock = () => new Date() }) {
  return {
    /**
     * One ledger's cash flows, oldest first, with totals over exactly the rows
     * returned. Trades are excluded unless asked for: the ledger is kept as a
     * record of money in and out, and that is what a trading desk wants.
     */
    async readCashflows({ token, since = null, until = null, includeTrades = false, limit = MAX_LIMIT }) {
      const entries = await repository.readEntries({
        userId: token.userId,
        ledgerId: token.ledgerId
      })

      const wanted = entries.filter(entry => (
        isCashType(entry) || (includeTrades && isTradeType(entry))
      ))

      let rows = sortByMoment(wanted.map(toCashflow)).filter(row => row.date)
      if (since) rows = rows.filter(row => row.date >= since)
      if (until) rows = rows.filter(row => row.date <= until)

      const total = rows.length
      // Newest wins when the window is capped: a desk that falls behind should
      // still see what just happened.
      const truncated = total > limit
      if (truncated) rows = rows.slice(total - limit)

      return {
        ledger: {
          id: token.ledger.id,
          name: token.ledger.name,
          revision: token.ledger.revision,
          updatedAt: token.ledger.updatedAt
        },
        query: { since, until, includeTrades, limit },
        currency: 'CNY',
        summary: summarise(rows),
        truncated,
        cashflows: rows,
        generatedAt: clock().toISOString()
      }
    }
  }
}

export const feedMaxLimit = MAX_LIMIT
