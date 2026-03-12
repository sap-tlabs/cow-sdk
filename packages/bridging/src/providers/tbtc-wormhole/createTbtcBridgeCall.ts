import { SupportedChainId, EvmCall } from '@cowprotocol/sdk-config'
import { getGlobalAdapter } from '@cowprotocol/sdk-common'

import type { QuoteBridgeRequest } from '../../types'
import type { BridgeDirection, TbtcQuoteResult } from './types'
import {
  TBTC_TOKEN_ADDRESSES,
  TOKEN_BRIDGE_ADDRESS,
  L2_WORMHOLE_GATEWAYS,
  WORMHOLE_CHAIN_IDS,
  TBTC_BRIDGE_HELPER_ADDRESSES,
  TBTC_BRIDGE_HELPER_ABI,
} from './const/contracts'

/**
 * Determine bridge direction from source -> destination chain.
 * L1 (Ethereum) -> L2: uses Token Bridge transferTokensWithPayload
 * L2 -> L1 (Ethereum): uses L2WormholeGateway sendTbtc
 */
export function getBridgeDirection(sourceChainId: SupportedChainId, destChainId: SupportedChainId): BridgeDirection {
  if (sourceChainId === destChainId) {
    throw new Error('Source and destination chains must be different')
  }

  if (sourceChainId === SupportedChainId.MAINNET) {
    if (!L2_WORMHOLE_GATEWAYS[destChainId]) {
      throw new Error(`No L2 gateway for destination chain ${destChainId}`)
    }
    return 'L1_TO_L2'
  }

  if (destChainId === SupportedChainId.MAINNET) {
    if (!L2_WORMHOLE_GATEWAYS[sourceChainId]) {
      throw new Error(`No L2 gateway for source chain ${sourceChainId}`)
    }
    return 'L2_TO_L1'
  }

  throw new Error(`Unsupported route: ${sourceChainId} -> ${destChainId}. Only L1<->L2 routes supported.`)
}

/**
 * Build the EvmCall that CoW Shed will delegate-call to initiate the bridge.
 * Targets the TbtcBridgeHelper contract which bundles approve + bridge deposit.
 */
export function createTbtcBridgeCall(params: {
  request: QuoteBridgeRequest
  quote: TbtcQuoteResult
}): EvmCall {
  const adapter = getGlobalAdapter()
  const { request, quote } = params
  const { bridgeDirection, sourceChainId, destChainId, wormholeMessageFee } = quote

  const helperAddress = TBTC_BRIDGE_HELPER_ADDRESSES[sourceChainId]
  if (!helperAddress || helperAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`TbtcBridgeHelper not deployed on chain ${sourceChainId}`)
  }

  const tbtcAddress = TBTC_TOKEN_ADDRESSES[sourceChainId]
  if (!tbtcAddress) {
    throw new Error(`tBTC not available on chain ${sourceChainId}`)
  }

  const recipient = request.receiver ?? request.owner ?? request.account
  if (!recipient) {
    throw new Error('Recipient address required: provide receiver, owner, or account')
  }

  const nonce = Math.floor(Math.random() * 0xFFFFFFFF)
  const recipientBytes32 = padAddressToBytes32(recipient)

  let callData: string

  if (bridgeDirection === 'L1_TO_L2') {
    const gateway = L2_WORMHOLE_GATEWAYS[destChainId]
    if (!gateway) throw new Error(`No L2 gateway for chain ${destChainId}`)

    const destWormholeChainId = WORMHOLE_CHAIN_IDS[destChainId]
    if (!destWormholeChainId) throw new Error(`No Wormhole chain ID for chain ${destChainId}`)

    callData = adapter.utils.encodeFunction(TBTC_BRIDGE_HELPER_ABI, 'depositL1ToL2', [
      tbtcAddress,
      TOKEN_BRIDGE_ADDRESS,
      request.amount,
      destWormholeChainId,
      padAddressToBytes32(gateway),
      nonce,
      recipientBytes32,
    ])
  } else {
    const gateway = L2_WORMHOLE_GATEWAYS[sourceChainId]
    if (!gateway) throw new Error(`No L2 gateway for chain ${sourceChainId}`)

    callData = adapter.utils.encodeFunction(TBTC_BRIDGE_HELPER_ABI, 'depositL2ToL1', [
      tbtcAddress,
      gateway,
      request.amount,
      recipientBytes32,
      nonce,
    ])
  }

  return {
    to: helperAddress,
    data: callData,
    value: wormholeMessageFee,
  }
}

function padAddressToBytes32(address: string): string {
  const stripped = address.toLowerCase().replace('0x', '')
  return '0x' + stripped.padStart(64, '0')
}
