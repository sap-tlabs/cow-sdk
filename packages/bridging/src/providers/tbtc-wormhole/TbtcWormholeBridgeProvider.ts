import type { EnrichedOrder } from '@cowprotocol/sdk-order-book'
import { OrderKind } from '@cowprotocol/sdk-order-book'
import type { ChainId, ChainInfo, EvmCall, SupportedChainId, TokenInfo } from '@cowprotocol/sdk-config'
import { arbitrumOne, base, mainnet } from '@cowprotocol/sdk-config'
import { CowShedSdk } from '@cowprotocol/sdk-cow-shed'
import type { SignerLike } from '@cowprotocol/sdk-common'
import { getGlobalAdapter, setGlobalAdapter } from '@cowprotocol/sdk-common'

import type {
  BridgeDeposit,
  BridgeHook,
  BridgeProviderInfo,
  BridgeStatusResult,
  BridgingDepositParams,
  BuyTokensParams,
  GetProviderBuyTokens,
  HookBridgeProvider,
  QuoteBridgeRequest,
} from '../../types'
import { DEFAULT_EXTRA_GAS_FOR_HOOK_ESTIMATION, DEFAULT_EXTRA_GAS_PROXY_CREATION, RAW_PROVIDERS_FILES_PATH } from '../../const'
import { BridgeProviderQuoteError, BridgeQuoteErrors } from '../../errors'
import { getGasLimitEstimationForHook } from '../utils/getGasLimitEstimationForHook'

import { TbtcWormholeApi } from './TbtcWormholeApi'
import type { TbtcWormholeBridgeProviderOptions, TbtcQuoteResult } from './types'
import { createTbtcBridgeCall, getBridgeDirection } from './createTbtcBridgeCall'
import {
  TBTC_TOKEN_ADDRESSES,
  L2_WORMHOLE_GATEWAYS,
  WORMHOLE_CORE_ADDRESSES,
  WORMHOLE_CORE_ABI,
  L2_WORMHOLE_GATEWAY_ABI,
} from './const/contracts'
import {
  TBTC_HOOK_DAPP_ID,
  TBTC_DECIMALS,
  EXPECTED_FILL_TIME_SECONDS,
  MIN_BRIDGE_AMOUNT,
  FALLBACK_MAX_BRIDGE_AMOUNT,
} from './const/misc'

const TBTC_SUPPORTED_NETWORKS: ChainInfo[] = [mainnet, arbitrumOne, base]
const SLIPPAGE_BPS = 0 // tBTC→tBTC bridge is 1:1

const providerType = 'HookBridgeProvider' as const

export type { TbtcQuoteResult, TbtcWormholeBridgeProviderOptions }

export class TbtcWormholeBridgeProvider implements HookBridgeProvider<TbtcQuoteResult> {
  type = providerType

  info: BridgeProviderInfo = {
    name: 'tBTC Wormhole',
    logoUrl: `${RAW_PROVIDERS_FILES_PATH}/tbtc-wormhole/tbtc-logo.png`,
    dappId: TBTC_HOOK_DAPP_ID,
    website: 'https://threshold.network',
    type: providerType,
  }

  protected api: TbtcWormholeApi
  protected cowShedSdk: CowShedSdk

  constructor(options: TbtcWormholeBridgeProviderOptions = {}) {
    const adapter = options.cowShedOptions?.adapter
    if (adapter) {
      setGlobalAdapter(adapter)
    }

    this.api = new TbtcWormholeApi()
    this.cowShedSdk = new CowShedSdk(adapter, options.cowShedOptions?.factoryOptions)
  }

  // ─── Network & Token Discovery ──────────────────────────────────────

  async getNetworks(): Promise<ChainInfo[]> {
    return TBTC_SUPPORTED_NETWORKS
  }

  async getBuyTokens(params: BuyTokensParams): Promise<GetProviderBuyTokens> {
    const tbtcAddress = TBTC_TOKEN_ADDRESSES[params.buyChainId as SupportedChainId]
    if (!tbtcAddress) {
      return { tokens: [], isRouteAvailable: false }
    }

    // Verify this is a supported L1↔L2 route
    if (params.sellChainId) {
      try {
        getBridgeDirection(params.sellChainId, params.buyChainId as SupportedChainId)
      } catch {
        return { tokens: [], isRouteAvailable: false }
      }
    }

    const token: TokenInfo = {
      chainId: params.buyChainId as number,
      address: tbtcAddress,
      name: 'tBTC v2',
      symbol: 'tBTC',
      decimals: TBTC_DECIMALS,
    }

    return { tokens: [token], isRouteAvailable: true }
  }

  async getIntermediateTokens(request: QuoteBridgeRequest): Promise<TokenInfo[]> {
    if (request.kind !== OrderKind.SELL) {
      throw new BridgeProviderQuoteError(BridgeQuoteErrors.ONLY_SELL_ORDER_SUPPORTED, { kind: request.kind })
    }

    const tbtcAddress = TBTC_TOKEN_ADDRESSES[request.sellTokenChainId]
    if (!tbtcAddress) return []

    return [
      {
        chainId: request.sellTokenChainId as number,
        address: tbtcAddress,
        name: 'tBTC v2',
        symbol: 'tBTC',
        decimals: TBTC_DECIMALS,
      },
    ]
  }

  // ─── Quote ──────────────────────────────────────────────────────────

  async getQuote(request: QuoteBridgeRequest): Promise<TbtcQuoteResult> {
    const sourceChainId = request.sellTokenChainId
    const destChainId = request.buyTokenChainId as SupportedChainId
    const direction = getBridgeDirection(sourceChainId, destChainId)

    const messageFee = await this.getWormholeMessageFee(sourceChainId)

    let remainingCapacity: bigint | null = null
    let maxDeposit = FALLBACK_MAX_BRIDGE_AMOUNT

    if (direction === 'L1_TO_L2') {
      remainingCapacity = await this.getRemainingMintingCapacity(destChainId)
      if (remainingCapacity !== null) {
        maxDeposit = remainingCapacity
      }
    }

    const sellAmount = request.amount
    if (sellAmount < MIN_BRIDGE_AMOUNT) {
      throw new BridgeProviderQuoteError(BridgeQuoteErrors.SELL_AMOUNT_TOO_SMALL, {
        amount: sellAmount.toString(),
        minimum: MIN_BRIDGE_AMOUNT.toString(),
      })
    }

    // tBTC→tBTC is 1:1, no price slippage
    const buyAmount = sellAmount

    return {
      isSell: true,
      amountsAndCosts: {
        costs: {
          bridgingFee: {
            feeBps: 0,
            amountInSellCurrency: messageFee,
            amountInBuyCurrency: messageFee,
          },
        },
        beforeFee: { sellAmount, buyAmount },
        afterFee: { sellAmount, buyAmount },
        afterSlippage: { sellAmount, buyAmount },
        slippageBps: SLIPPAGE_BPS,
      },
      quoteTimestamp: Date.now(),
      expectedFillTimeSeconds: EXPECTED_FILL_TIME_SECONDS,
      fees: {
        bridgeFee: messageFee,
        destinationGasFee: 0n,
      },
      limits: {
        minDeposit: MIN_BRIDGE_AMOUNT,
        maxDeposit,
      },
      bridgeDirection: direction,
      sourceChainId,
      destChainId,
      wormholeMessageFee: messageFee,
      remainingMintingCapacity: remainingCapacity,
    }
  }

  // ─── Transaction Building ───────────────────────────────────────────

  async getUnsignedBridgeCall(request: QuoteBridgeRequest, quote: TbtcQuoteResult): Promise<EvmCall> {
    return createTbtcBridgeCall({ request, quote })
  }

  async getGasLimitEstimationForHook(request: QuoteBridgeRequest): Promise<number> {
    return getGasLimitEstimationForHook({
      cowShedSdk: this.cowShedSdk,
      request,
      extraGas: DEFAULT_EXTRA_GAS_FOR_HOOK_ESTIMATION,
      extraGasProxyCreation: DEFAULT_EXTRA_GAS_PROXY_CREATION,
    })
  }

  async getSignedHook(
    chainId: SupportedChainId,
    unsignedCall: EvmCall,
    bridgeHookNonce: string,
    deadline: bigint,
    hookGasLimit: number,
    signer?: SignerLike,
  ): Promise<BridgeHook> {
    const { signedMulticall, cowShedAccount, gasLimit } = await this.cowShedSdk.signCalls({
      calls: [
        {
          target: unsignedCall.to,
          value: unsignedCall.value,
          callData: unsignedCall.data,
          allowFailure: false,
          isDelegateCall: true,
        },
      ],
      chainId,
      signer,
      gasLimit: BigInt(hookGasLimit),
      deadline,
      nonce: bridgeHookNonce,
    })

    return {
      postHook: {
        target: signedMulticall.to,
        callData: signedMulticall.data,
        gasLimit: gasLimit.toString(),
        dappId: TBTC_HOOK_DAPP_ID,
      },
      recipient: cowShedAccount,
    }
  }

  // ─── Status & Tracking ──────────────────────────────────────────────

  async getStatus(bridgingId: string, originChainId: SupportedChainId): Promise<BridgeStatusResult> {
    return this.api.getStatus(bridgingId, originChainId)
  }

  async getBridgingParams(
    chainId: ChainId,
    order: EnrichedOrder,
    txHash: string,
  ): Promise<{ params: BridgingDepositParams; status: BridgeStatusResult } | null> {
    const adapter = getGlobalAdapter()

    let txReceipt
    try {
      txReceipt = await adapter.getTransactionReceipt(txHash)
    } catch {
      return null
    }
    if (!txReceipt) return null

    const sequence = this.api.extractSequenceFromReceipt(txReceipt)
    if (!sequence) return null

    const status = await this.api.getStatus(txHash, chainId as SupportedChainId)

    return {
      params: {
        inputTokenAddress: order.sellToken,
        outputTokenAddress: order.buyToken,
        inputAmount: BigInt(order.sellAmount),
        outputAmount: BigInt(order.buyAmount),
        owner: order.owner,
        quoteTimestamp: null,
        fillDeadline: null,
        recipient: order.receiver ?? order.owner,
        sourceChainId: chainId as number,
        destinationChainId: chainId as number, // TODO: extract from order appData
        bridgingId: order.uid,
      },
      status,
    }
  }

  getExplorerUrl(bridgingId: string): string {
    return `https://wormholescan.io/#/tx/${bridgingId}`
  }

  // ─── Not Applicable ─────────────────────────────────────────────────

  async decodeBridgeHook(): Promise<BridgeDeposit> {
    throw new Error('decodeBridgeHook not implemented for tBTC Wormhole provider')
  }

  async getCancelBridgingTx(): Promise<EvmCall> {
    throw new Error('Wormhole deposits cannot be cancelled once submitted')
  }

  async getRefundBridgingTx(): Promise<EvmCall> {
    throw new Error('Wormhole deposits cannot be refunded — VAA must be redeemed')
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private async getWormholeMessageFee(chainId: SupportedChainId): Promise<bigint> {
    const coreAddress = WORMHOLE_CORE_ADDRESSES[chainId]
    if (!coreAddress) return 0n

    try {
      const adapter = getGlobalAdapter()
      const result = await adapter.readContract({
        address: coreAddress,
        abi: WORMHOLE_CORE_ABI,
        functionName: 'messageFee',
      })
      return BigInt(result as string | number)
    } catch {
      return 0n
    }
  }

  private async getRemainingMintingCapacity(destChainId: SupportedChainId): Promise<bigint | null> {
    const gatewayAddress = L2_WORMHOLE_GATEWAYS[destChainId]
    if (!gatewayAddress) return null

    try {
      const adapter = getGlobalAdapter()
      const [limitResult, mintedResult] = await Promise.all([
        adapter.readContract({
          address: gatewayAddress,
          abi: L2_WORMHOLE_GATEWAY_ABI,
          functionName: 'mintingLimit',
        }),
        adapter.readContract({
          address: gatewayAddress,
          abi: L2_WORMHOLE_GATEWAY_ABI,
          functionName: 'mintedAmount',
        }),
      ])

      const limit = BigInt(limitResult as string | number)
      const minted = BigInt(mintedResult as string | number)
      return limit > minted ? limit - minted : 0n
    } catch {
      return null
    }
  }
}
