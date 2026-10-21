import { isCashType, isTradeType, sortByMoment, summarise, toCashflow } from './cashflow.js'
import { shapeDebts } from './debts.js'

const MAX_LIMIT = 2000

function ledgerOf(token) {
  return {
    id: token.ledger.id,
    name: token.ledger.name,
    revision: token.ledger.revision,
    updatedAt: token.ledger.updatedAt
  }
}

export function createFeedService({ repository, clock = () => new Date() }) {
  return {
    /**
     * One ledger's cash flows, oldest first, with totals over exactly the rows
     * returned. Trades are excluded unless asked for: the ledger is kept as a
     * record of money in and out, and that is what a trading desk wants.
     * Transfers between the user's own platforms count as cash here.
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
        ledger: ledgerOf(token),
        query: { since, until, includeTrades, limit },
        currency: 'CNY',
        summary: summarise(rows),
        truncated,
        cashflows: rows,
        generatedAt: clock().toISOString()
      }
    },

    /**
     * Every loan with its repayments — those logged on the loan and those
     * logged as a 出金 in the ledger — and what is still owed. Not windowed:
     * a balance only makes sense over the loan's whole life.
     */
    async readDebts({ token }) {
      const owner = { userId: token.userId, ledgerId: token.ledgerId }
      const [debts, entries] = await Promise.all([
        repository.readDebts(owner),
        repository.readEntries(owner)
      ])
      return {
        ledger: ledgerOf(token),
        currency: 'CNY',
        generatedAt: clock().toISOString(),
        ...shapeDebts({ debts, entries })
      }
    }
  }
}

export const feedMaxLimit = MAX_LIMIT
