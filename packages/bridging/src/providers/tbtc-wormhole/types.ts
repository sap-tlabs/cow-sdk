import type { SupportedChainId } from '@cowprotocol/sdk-config'
import type { CowShedSdkOptions } from '@cowprotocol/sdk-cow-shed'
import type { AbstractProviderAdapter } from '@cowprotocol/sdk-common'
import type { BridgeQuoteResult } from '../../types'

export type BridgeDirection = 'L1_TO_L2' | 'L2_TO_L1'

export interface TbtcWormholeBridgeProviderOptions {
  cowShedOptions?: {
    adapter?: AbstractProviderAdapter
    factoryOptions?: CowShedSdkOptions['factoryOptions']
  }
}

export interface TbtcQuoteResult extends BridgeQuoteResult {
  bridgeDirection: BridgeDirection
  sourceChainId: SupportedChainId
  destChainId: SupportedChainId
  wormholeMessageFee: bigint
  remainingMintingCapacity: bigint | null
}

export interface WormholeVaaResponse {
  data?: Array<{
    vaa?: string
    sequence?: string
  }>
}
