import type { SupportedChainId } from '@cowprotocol/sdk-config'

import type { BridgeStatusResult } from '../../types'
import { BridgeStatus } from '../../types'
import type { MayanApiQuote, MayanSwapStatus } from './types'
import { MAYAN_CHAIN_NAMES } from './const/contracts'
import {
  MAYAN_PRICE_API_BASE,
  MAYAN_EXPLORER_API_BASE,
  DEFAULT_SLIPPAGE_BPS,
  REFERRER_BPS,
  QUOTE_TIMEOUT_MS,
} from './const/misc'
import { THRESHOLD_EVM_REFERRER } from './const/contracts'

export class MayanApi {
  /**
   * Fetch bridge/swap quotes from Mayan's Price API.
   * Returns the best quote (first in array) or null if no routes available.
   */
  async getQuote(params: {
    fromToken: string
    toToken: string
    fromChainId: SupportedChainId
    toChainId: SupportedChainId
    amount: bigint
    fromDecimals: number
    slippageBps?: number
  }): Promise<MayanApiQuote | null> {
    const fromChain = MAYAN_CHAIN_NAMES[params.fromChainId]
    const toChain = MAYAN_CHAIN_NAMES[params.toChainId]
    if (!fromChain || !toChain) return null

    const amountFloat = Number(params.amount) / 10 ** params.fromDecimals

    const queryParams = new URLSearchParams({
      amount: amountFloat.toString(),
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromChain,
      toChain,
      slippageBps: (params.slippageBps ?? DEFAULT_SLIPPAGE_BPS).toString(),
      referrer: THRESHOLD_EVM_REFERRER,
      referrerBps: REFERRER_BPS.toString(),
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)

    try {
      const response = await fetch(`${MAYAN_PRICE_API_BASE}/quote?${queryParams}`, {
        signal: controller.signal,
      })

      if (!response.ok) return null

      const data = (await response.json()) as MayanApiQuote[] | { quotes: MayanApiQuote[] }

      // API may return array directly or wrapped in { quotes: [...] }
      const quotes = Array.isArray(data) ? data : data.quotes ?? []
      if (quotes.length === 0) return null

      const best = quotes[0] as MayanApiQuote
      best._raw = best
      return best
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Poll Mayan Explorer API for swap status by source transaction hash.
   */
  async getStatus(txHash: string): Promise<BridgeStatusResult> {
    try {
      const response = await fetch(`${MAYAN_EXPLORER_API_BASE}/swap/trx/${txHash}`)
      if (!response.ok) {
        return { status: BridgeStatus.IN_PROGRESS, depositTxHash: txHash }
      }

      const data = (await response.json()) as MayanSwapStatus

      const completedStatuses = ['SETTLED_ON_SOLANA', 'REDEEMED', 'COMPLETED']
      const failedStatuses = ['REFUNDED', 'FAILED']

      if (completedStatuses.includes(data.status) || data.completedAt) {
        return {
          status: BridgeStatus.EXECUTED,
          depositTxHash: txHash,
          fillTxHash: data.destTxHash,
        }
      }

      if (failedStatuses.includes(data.status)) {
        return {
          status: BridgeStatus.REFUND,
          depositTxHash: txHash,
        }
      }

      return { status: BridgeStatus.IN_PROGRESS, depositTxHash: txHash }
    } catch {
      return { status: BridgeStatus.IN_PROGRESS, depositTxHash: txHash }
    }
  }
}
