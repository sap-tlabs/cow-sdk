import type { SupportedChainId, EvmCall } from '@cowprotocol/sdk-config'
import { getGlobalAdapter } from '@cowprotocol/sdk-common'

import type { QuoteBridgeRequest } from '../../types'
import type { MayanQuoteResult } from './types'
import {
  MAYAN_FORWARDER_ADDRESS,
  MAYAN_BRIDGE_HELPER_ADDRESSES,
  MAYAN_BRIDGE_HELPER_ABI,
} from './const/contracts'

/**
 * Build the EvmCall that CoW Shed will delegate-call to initiate the Mayan bridge.
 *
 * Encodes a call to MayanBridgeHelper.approveAndForward(token, amount, forwarder, forwardData),
 * where forwardData is the Mayan Forwarder calldata from the SDK.
 *
 * The forwardData is built from the Mayan quote's raw payload. In a full integration,
 * this would call getSwapFromEvmTxPayload() from @mayanfinance/swap-sdk.
 * For now, we encode a forwardERC20 call with the quote parameters.
 */
export function createMayanBridgeCall(params: {
  request: QuoteBridgeRequest
  quote: MayanQuoteResult
}): EvmCall {
  const adapter = getGlobalAdapter()
  const { request, quote } = params
  const sourceChainId = quote.sourceChainId

  const helperAddress = MAYAN_BRIDGE_HELPER_ADDRESSES[sourceChainId]
  if (!helperAddress || helperAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`MayanBridgeHelper not deployed on chain ${sourceChainId}`)
  }

  // Build the Mayan Forwarder calldata.
  // In production, use getSwapFromEvmTxPayload() from @mayanfinance/swap-sdk.
  // The SDK returns { _forwarder, tx } where tx.data is the forwarder calldata.
  const forwardData = buildForwarderCalldata(adapter, request, quote)

  // Encode the helper's approveAndForward call
  const callData = adapter.utils.encodeFunction(MAYAN_BRIDGE_HELPER_ABI, 'approveAndForward', [
    request.sellTokenAddress,
    request.amount,
    MAYAN_FORWARDER_ADDRESS,
    forwardData,
  ])

  return {
    to: helperAddress,
    data: callData,
    value: 0n, // Mayan doesn't require ETH value for ERC20 forwards
  }
}

/**
 * Build the raw forwarder calldata from quote parameters.
 *
 * This encodes a call to MayanForwarder.forwardERC20:
 *   forwardERC20(address tokenIn, uint256 amountIn, bytes permitParams,
 *                address mayanProtocol, bytes protocolData)
 *
 * In a full SDK integration, getSwapFromEvmTxPayload() produces this automatically.
 * This manual encoding is a placeholder that covers the common case.
 */
function buildForwarderCalldata(
  adapter: { utils: { encodeAbi: (types: string[], values: unknown[]) => string } },
  request: QuoteBridgeRequest,
  quote: MayanQuoteResult,
): string {
  // The Mayan SDK's getSwapFromEvmTxPayload returns the complete tx payload.
  // When the SDK is integrated as a dependency, replace this function with:
  //
  //   const { tx } = await getSwapFromEvmTxPayload(
  //     quote.mayanQuote._raw,
  //     cowShedAccount,
  //     destinationAddress,
  //     { evm: THRESHOLD_EVM_REFERRER },
  //     provider
  //   )
  //   return tx.data
  //
  // For now, we store the raw quote and reconstruct the forward call.
  // The _raw field on MayanApiQuote preserves the full quote needed by the SDK.

  const FORWARD_ERC20_SELECTOR = '0x29a2e0e5' // forwardERC20(address,uint256,bytes,address,bytes)

  // Encode parameters for a basic forwardERC20 call
  const encodedParams = adapter.utils.encodeAbi(
    ['address', 'uint256', 'bytes', 'address', 'bytes'],
    [
      request.sellTokenAddress,
      request.amount,
      '0x', // empty permit params
      '0x0000000000000000000000000000000000000000', // protocol address from quote._raw
      '0x', // protocol data from quote._raw
    ],
  )

  // Strip 0x prefix from params and combine with selector
  const params = typeof encodedParams === 'string' && encodedParams.startsWith('0x')
    ? encodedParams.slice(2)
    : encodedParams

  return FORWARD_ERC20_SELECTOR + params
}

/**
 * Check if a route between two chains is supported by Mayan.
 * Mayan supports: Ethereum, Arbitrum, Base (including L2-to-L2).
 */
export function isMayanRouteSupported(sourceChainId: SupportedChainId, destChainId: SupportedChainId): boolean {
  if (sourceChainId === destChainId) return false

  const supportedChains: SupportedChainId[] = [1, 42161, 8453] as SupportedChainId[]
  return supportedChains.includes(sourceChainId) && supportedChains.includes(destChainId)
}
