import type { EnrichedOrder } from '@cowprotocol/sdk-order-book'
import { OrderKind } from '@cowprotocol/sdk-order-book'
import type { ChainId, ChainInfo, EvmCall, SupportedChainId, TokenInfo } from '@cowprotocol/sdk-config'
import { arbitrumOne, base, mainnet } from '@cowprotocol/sdk-config'
import { CowShedSdk } from '@cowprotocol/sdk-cow-shed'
import type { SignerLike } from '@cowprotocol/sdk-common'
import { setGlobalAdapter } from '@cowprotocol/sdk-common'

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

import { MayanApi } from './MayanApi'
import type { MayanBridgeProviderOptions, MayanQuoteResult } from './types'
import { createMayanBridgeCall, isMayanRouteSupported } from './createMayanBridgeCall'
import { MAYAN_CHAIN_NAMES } from './const/contracts'
import {
  MAYAN_HOOK_DAPP_ID,
  EXPECTED_FILL_TIME_SECONDS,
  DEFAULT_SLIPPAGE_BPS,
  MIN_BRIDGE_AMOUNT,
} from './const/misc'

const MAYAN_SUPPORTED_NETWORKS: ChainInfo[] = [mainnet, arbitrumOne, base]

const providerType = 'HookBridgeProvider' as const

export type { MayanQuoteResult, MayanBridgeProviderOptions }

export class MayanBridgeProvider implements HookBridgeProvider<MayanQuoteResult> {
  type = providerType

  info: BridgeProviderInfo = {
    name: 'Mayan',
    logoUrl: `${RAW_PROVIDERS_FILES_PATH}/mayan/mayan-logo.png`,
    dappId: MAYAN_HOOK_DAPP_ID,
    website: 'https://mayan.finance',
    type: providerType,
  }

  protected api: MayanApi
  protected cowShedSdk: CowShedSdk

  constructor(options: MayanBridgeProviderOptions = {}) {
    const adapter = options.cowShedOptions?.adapter
    if (adapter) {
      setGlobalAdapter(adapter)
    }

    this.api = new MayanApi()
    this.cowShedSdk = new CowShedSdk(adapter, options.cowShedOptions?.factoryOptions)
  }

  // ─── Network & Token Discovery ──────────────────────────────────────

  async getNetworks(): Promise<ChainInfo[]> {
    return MAYAN_SUPPORTED_NETWORKS
  }

  async getBuyTokens(params: BuyTokensParams): Promise<GetProviderBuyTokens> {
    const destChain = MAYAN_CHAIN_NAMES[params.buyChainId as SupportedChainId]
    if (!destChain) {
      return { tokens: [], isRouteAvailable: false }
    }

    if (params.sellChainId) {
      if (!isMayanRouteSupported(params.sellChainId, params.buyChainId as SupportedChainId)) {
        return { tokens: [], isRouteAvailable: false }
      }
    }

    const tokens = await this.api.getTokens(params.buyChainId as SupportedChainId)
    const isRouteAvailable = tokens.length > 0

    return { tokens, isRouteAvailable }
  }

  async getIntermediateTokens(request: QuoteBridgeRequest): Promise<TokenInfo[]> {
    if (request.kind !== OrderKind.SELL) {
      throw new BridgeProviderQuoteError(BridgeQuoteErrors.ONLY_SELL_ORDER_SUPPORTED, { kind: request.kind })
    }

    // Mayan can swap+bridge in one step, so the intermediate token
    // IS the sell token on the source chain. The Mayan Forwarder handles
    // the swap internally if needed.
    return [
      {
        chainId: request.sellTokenChainId as number,
        address: request.sellTokenAddress,
        name: '',
        symbol: '',
        decimals: request.sellTokenDecimals,
      },
    ]
  }

  // ─── Quote ──────────────────────────────────────────────────────────

  async getQuote(request: QuoteBridgeRequest): Promise<MayanQuoteResult> {
    const sourceChainId = request.sellTokenChainId
    const destChainId = request.buyTokenChainId as SupportedChainId

    if (!isMayanRouteSupported(sourceChainId, destChainId)) {
      throw new BridgeProviderQuoteError(BridgeQuoteErrors.NO_ROUTES, {
        source: sourceChainId,
        dest: destChainId,
      })
    }

    if (request.amount < MIN_BRIDGE_AMOUNT) {
      throw new BridgeProviderQuoteError(BridgeQuoteErrors.SELL_AMOUNT_TOO_SMALL, {
        amount: request.amount.toString(),
      })
    }

    const mayanQuote = await this.api.getQuote({
      fromToken: request.sellTokenAddress,
      toToken: request.buyTokenAddress,
      fromChainId: sourceChainId,
      toChainId: destChainId,
      amount: request.amount,
      fromDecimals: request.sellTokenDecimals,
      slippageBps: request.bridgeSlippageBps ?? DEFAULT_SLIPPAGE_BPS,
    })

    if (!mayanQuote) {
      throw new BridgeProviderQuoteError(BridgeQuoteErrors.NO_ROUTES, {
        source: sourceChainId,
        dest: destChainId,
      })
    }

    const sellAmount = request.amount
    const buyDecimals = request.buyTokenDecimals
    const buyAmount = BigInt(Math.floor(mayanQuote.expectedAmountOut * 10 ** buyDecimals))
    const minBuyAmount = BigInt(Math.floor(mayanQuote.minAmountOut * 10 ** buyDecimals))

    const totalRelayerFee = mayanQuote.swapRelayerFee + mayanQuote.redeemRelayerFee + mayanQuote.solanaRelayerFee
    const bridgeFee = BigInt(Math.floor(totalRelayerFee * 10 ** buyDecimals))

    return {
      isSell: true,
      amountsAndCosts: {
        costs: {
          bridgingFee: {
            feeBps: mayanQuote.protocolBps + mayanQuote.referrerBps,
            amountInSellCurrency: bridgeFee,
            amountInBuyCurrency: bridgeFee,
          },
        },
        beforeFee: { sellAmount, buyAmount },
        afterFee: { sellAmount, buyAmount: minBuyAmount },
        afterSlippage: { sellAmount, buyAmount: minBuyAmount },
        slippageBps: DEFAULT_SLIPPAGE_BPS,
      },
      quoteTimestamp: Date.now(),
      expectedFillTimeSeconds: mayanQuote.etaSeconds || EXPECTED_FILL_TIME_SECONDS,
      fees: {
        bridgeFee,
        destinationGasFee: 0n,
      },
      limits: {
        minDeposit: MIN_BRIDGE_AMOUNT,
        maxDeposit: sellAmount * 100n,
      },
      sourceChainId,
      destChainId,
      mayanQuote,
    }
  }

  // ─── Transaction Building ───────────────────────────────────────────

  async getUnsignedBridgeCall(request: QuoteBridgeRequest, quote: MayanQuoteResult): Promise<EvmCall> {
    const ownerAddress = request.owner ?? request.account
    if (!ownerAddress) {
      throw new Error('Owner or account address required to derive CowShed proxy')
    }

    const cowShedAccount = this.cowShedSdk.getCowShedAccount(request.sellTokenChainId, ownerAddress)
    const destinationAddress = request.receiver ?? ownerAddress

    return createMayanBridgeCall({ request, quote, cowShedAccount, destinationAddress })
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
        dappId: MAYAN_HOOK_DAPP_ID,
      },
      recipient: cowShedAccount,
    }
  }

  // ─── Status & Tracking ──────────────────────────────────────────────

  async getStatus(bridgingId: string, _originChainId: SupportedChainId): Promise<BridgeStatusResult> {
    return this.api.getStatus(bridgingId)
  }

  async getBridgingParams(
    chainId: ChainId,
    order: EnrichedOrder,
    txHash: string,
  ): Promise<{ params: BridgingDepositParams; status: BridgeStatusResult } | null> {
    const status = await this.api.getStatus(txHash)

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
        destinationChainId: chainId as number,
        bridgingId: order.uid,
      },
      status,
    }
  }

  getExplorerUrl(bridgingId: string): string {
    return `https://explorer.mayan.finance/swap/${bridgingId}`
  }

  // ─── Not Applicable ─────────────────────────────────────────────────

  async decodeBridgeHook(): Promise<BridgeDeposit> {
    throw new Error('Not implemented')
  }

  async getCancelBridgingTx(): Promise<EvmCall> {
    throw new Error('Mayan swaps cannot be cancelled once submitted')
  }

  async getRefundBridgingTx(): Promise<EvmCall> {
    throw new Error('Mayan handles refunds automatically via its relay system')
  }
}
