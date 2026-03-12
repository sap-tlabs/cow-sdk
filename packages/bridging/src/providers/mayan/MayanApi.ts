import type { SupportedChainId, TokenInfo } from '@cowprotocol/sdk-config'
import { fetchQuote as mayanFetchQuote } from '@mayanfinance/swap-sdk'

import type { BridgeStatusResult } from '../../types'
import { BridgeStatus } from '../../types'
import type { MayanApiQuote, MayanSwapStatus } from './types'
import { MAYAN_CHAIN_NAMES } from './const/contracts'
import { THRESHOLD_EVM_REFERRER } from './const/contracts'
import {
  MAYAN_EXPLORER_API_BASE,
  MAYAN_TOKENS_API_BASE,
  DEFAULT_SLIPPAGE_BPS,
  REFERRER_BPS,
  QUOTE_TIMEOUT_MS,
} from './const/misc'

export type MayanSdkQuote = Awaited<ReturnType<typeof mayanFetchQuote>>[number]

export class MayanApi {
  /**
   * Fetch bridge/swap quotes using the Mayan SDK's fetchQuote.
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

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)

    try {
      const quotes: MayanSdkQuote[] = await mayanFetchQuote({
        amount: amountFloat,
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromChain: fromChain as Parameters<typeof mayanFetchQuote>[0]['fromChain'],
        toChain: toChain as Parameters<typeof mayanFetchQuote>[0]['toChain'],
        slippageBps: params.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
        referrer: THRESHOLD_EVM_REFERRER,
        referrerBps: REFERRER_BPS,
      })

      const best = quotes[0]
      if (!best) return null

      return this.mapSdkQuoteToApiQuote(best)
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Fetch supported tokens for a given chain from Mayan's tokens API.
   */
  async getTokens(chainId: SupportedChainId): Promise<TokenInfo[]> {
    const chainName = MAYAN_CHAIN_NAMES[chainId]
    if (!chainName) return []

    try {
      const response = await fetch(MAYAN_TOKENS_API_BASE)
      if (!response.ok) return []

      const data = (await response.json()) as Record<string, MayanTokenApiEntry[]>
      const chainTokens = data[chainName]
      if (!Array.isArray(chainTokens)) return []

      return chainTokens
        .filter((t) => t.verified && t.contract !== '0x0000000000000000000000000000000000000000')
        .map((t) => ({
          chainId: chainId as number,
          address: t.contract,
          name: t.name,
          symbol: t.symbol,
          decimals: t.decimals,
          logoUrl: t.logoURI,
        }))
    } catch {
      return []
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

  private mapSdkQuoteToApiQuote(sdkQuote: MayanSdkQuote): MayanApiQuote {
    return {
      type: sdkQuote.type,
      effectiveAmountIn: sdkQuote.effectiveAmountIn,
      expectedAmountOut: sdkQuote.expectedAmountOut,
      minAmountOut: sdkQuote.minAmountOut,
      minReceived: sdkQuote.minReceived,
      etaSeconds: sdkQuote.etaSeconds,
      price: sdkQuote.price,
      priceImpact: sdkQuote.priceImpact ?? 0,
      swapRelayerFee: sdkQuote.swapRelayerFee,
      redeemRelayerFee: sdkQuote.redeemRelayerFee,
      refundRelayerFee: sdkQuote.refundRelayerFee,
      solanaRelayerFee: sdkQuote.solanaRelayerFee,
      deadline64: sdkQuote.deadline64,
      referrerBps: sdkQuote.referrerBps ?? 0,
      protocolBps: sdkQuote.protocolBps ?? 0,
      fromToken: sdkQuote.fromToken,
      toToken: sdkQuote.toToken,
      fromChain: sdkQuote.fromChain,
      toChain: sdkQuote.toChain,
      _raw: sdkQuote,
    }
  }
}

interface MayanTokenApiEntry {
  name: string
  symbol: string
  contract: string
  mint: string
  chainId: number
  decimals: number
  logoURI: string
  verified: boolean
  standard: string
}
