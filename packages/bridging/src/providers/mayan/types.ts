import type { SupportedChainId } from '@cowprotocol/sdk-config'
import type { CowShedSdkOptions } from '@cowprotocol/sdk-cow-shed'
import type { AbstractProviderAdapter } from '@cowprotocol/sdk-common'
import type { BridgeQuoteResult } from '../../types'

export interface MayanBridgeProviderOptions {
  cowShedOptions?: {
    adapter?: AbstractProviderAdapter
    factoryOptions?: CowShedSdkOptions['factoryOptions']
  }
}

export interface MayanQuoteResult extends BridgeQuoteResult {
  sourceChainId: SupportedChainId
  destChainId: SupportedChainId
  /** The raw Mayan quote used to build the forwarder calldata */
  mayanQuote: MayanApiQuote
}

/** Subset of Mayan Price API quote response we actually use */
export interface MayanApiQuote {
  type: string // 'SWIFT' | 'MCTP' | 'WH'
  effectiveAmountIn: number
  expectedAmountOut: number
  minAmountOut: number
  minReceived: number
  etaSeconds: number
  price: number
  priceImpact: number
  swapRelayerFee: number
  redeemRelayerFee: number
  refundRelayerFee: number
  solanaRelayerFee: number
  deadline64: string
  referrerBps: number
  protocolBps: number
  fromToken: MayanTokenInfo
  toToken: MayanTokenInfo
  fromChain: string
  toChain: string
  /** Full quote object needed by the SDK to build tx payload */
  _raw: unknown
}

export interface MayanTokenInfo {
  mint: string
  contract: string
  chainId: number
  name: string
  symbol: string
  decimals: number
  logoURI: string
}

export interface MayanSwapStatus {
  status: string
  completedAt?: string
  destChain?: string
  toAmount?: string
  toTokenSymbol?: string
  orderHash?: string
  sourceTxHash?: string
  destTxHash?: string
}
