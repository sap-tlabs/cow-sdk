import type { SupportedChainId, EvmCall } from '@cowprotocol/sdk-config'
import { getGlobalAdapter } from '@cowprotocol/sdk-common'
import { getSwapFromEvmTxPayload } from '@mayanfinance/swap-sdk'
import type { MayanSdkQuote } from './MayanApi'

import type { QuoteBridgeRequest } from '../../types'
import type { MayanQuoteResult } from './types'
import {
  MAYAN_BRIDGE_HELPER_ADDRESSES,
  MAYAN_BRIDGE_HELPER_ABI,
  THRESHOLD_EVM_REFERRER,
} from './const/contracts'

/**
 * Build the EvmCall that CoW Shed will delegate-call to initiate the Mayan bridge.
 *
 * Uses the Mayan SDK's getSwapFromEvmTxPayload to build canonical forwarder calldata,
 * then wraps it in MayanBridgeHelper.approveAndForward(token, amount, forwarder, forwardData).
 */
export async function createMayanBridgeCall(params: {
  request: QuoteBridgeRequest
  quote: MayanQuoteResult
  cowShedAccount: string
  destinationAddress: string
}): Promise<EvmCall> {
  const adapter = getGlobalAdapter()
  const { request, quote, cowShedAccount, destinationAddress } = params
  const sourceChainId = quote.sourceChainId

  const helperAddress = MAYAN_BRIDGE_HELPER_ADDRESSES[sourceChainId]
  if (!helperAddress || helperAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`MayanBridgeHelper not deployed on chain ${sourceChainId}`)
  }

  const sdkQuote = quote.mayanQuote._raw as MayanSdkQuote
  if (!sdkQuote) {
    throw new Error('Missing raw Mayan SDK quote — required for building forwarder calldata')
  }

  // Build the Mayan Forwarder transaction via the SDK.
  // The CowShed proxy is the swapper/signer (it holds tokens after the CoW swap).
  const sdkResult = await getSwapFromEvmTxPayload(
    sdkQuote,
    cowShedAccount,
    destinationAddress,
    { evm: THRESHOLD_EVM_REFERRER },
    cowShedAccount,
    sourceChainId,
    null,
    null,
  )

  const forwarderAddress = sdkResult.to as string
  const forwarderCalldata = sdkResult.data as string
  const forwarderValue = sdkResult.value ? BigInt(sdkResult.value.toString()) : 0n

  // Wrap in the helper's approveAndForward: approve the forwarder, then forward the call
  const callData = adapter.utils.encodeFunction(MAYAN_BRIDGE_HELPER_ABI, 'approveAndForward', [
    request.sellTokenAddress,
    request.amount,
    forwarderAddress,
    forwarderCalldata,
  ])

  return {
    to: helperAddress,
    data: callData,
    value: forwarderValue,
  }
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
