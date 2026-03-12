import type { SupportedChainId } from '@cowprotocol/sdk-config'

import type { BridgeStatusResult } from '../../types'
import { BridgeStatus } from '../../types'
import { WORMHOLE_SCAN_BASE_URL, LOG_MESSAGE_PUBLISHED_TOPIC } from './const/misc'
import { WORMHOLE_CHAIN_IDS } from './const/contracts'
import type { WormholeVaaResponse } from './types'

export class TbtcWormholeApi {
  /**
   * Poll WormholeScan for VAA status by source tx hash.
   * Returns EXECUTED once the VAA is signed, IN_PROGRESS while pending.
   */
  async getStatus(txHash: string, originChainId: SupportedChainId): Promise<BridgeStatusResult> {
    const wormholeChainId = WORMHOLE_CHAIN_IDS[originChainId]
    if (!wormholeChainId) {
      return { status: BridgeStatus.UNKNOWN }
    }

    try {
      const url = `${WORMHOLE_SCAN_BASE_URL}/api/v1/vaas?txHash=${txHash}`
      const response = await fetch(url)

      if (!response.ok) {
        return { status: BridgeStatus.IN_PROGRESS, depositTxHash: txHash }
      }

      const body = (await response.json()) as WormholeVaaResponse
      const firstVaa = body?.data?.[0]
      if (firstVaa?.vaa) {
        return {
          status: BridgeStatus.EXECUTED,
          depositTxHash: txHash,
        }
      }

      return { status: BridgeStatus.IN_PROGRESS, depositTxHash: txHash }
    } catch {
      return { status: BridgeStatus.IN_PROGRESS, depositTxHash: txHash }
    }
  }

  /**
   * Extract the Wormhole sequence number from a transaction receipt's logs.
   * Looks for the LogMessagePublished event emitted by Wormhole Core.
   *
   * LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)
   * Only `sender` is indexed (topics[1]). The sequence is the first uint64 in the ABI-encoded data field.
   */
  extractSequenceFromReceipt(receipt: { logs: Array<{ topics: readonly string[]; data: string }> }): string | null {
    for (const log of receipt.logs) {
      if (log.topics[0] === LOG_MESSAGE_PUBLISHED_TOPIC) {
        // sequence is the first uint64 in data, ABI-encoded as uint256 (32 bytes, zero-padded)
        if (log.data.length >= 66) {
          const sequenceHex = log.data.slice(2, 66) // first 32 bytes of data
          return BigInt('0x' + sequenceHex).toString()
        }
      }
    }
    return null
  }
}
