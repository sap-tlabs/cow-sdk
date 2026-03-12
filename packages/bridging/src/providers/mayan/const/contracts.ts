import { SupportedChainId } from '@cowprotocol/sdk-config'

// Mayan Forwarder — same address on all EVM chains
export const MAYAN_FORWARDER_ADDRESS = '0x0654874eb7F59C6f5b39931FC45dC45337c967c3'

// MayanBridgeHelper — stateless delegate-call target deployed per chain
// TODO: deploy via Threshold multisig, then fill in addresses
export const MAYAN_BRIDGE_HELPER_ADDRESSES: Partial<Record<SupportedChainId, string>> = {
  [SupportedChainId.MAINNET]: '0x0000000000000000000000000000000000000000',
  [SupportedChainId.ARBITRUM_ONE]: '0x0000000000000000000000000000000000000000',
  [SupportedChainId.BASE]: '0x0000000000000000000000000000000000000000',
}

// CoW SupportedChainId → Mayan chain name string
export const MAYAN_CHAIN_NAMES: Partial<Record<SupportedChainId, string>> = {
  [SupportedChainId.MAINNET]: 'ethereum',
  [SupportedChainId.ARBITRUM_ONE]: 'arbitrum',
  [SupportedChainId.BASE]: 'base',
}

// Reverse mapping: Mayan chain name → CoW chain ID
export const MAYAN_CHAIN_IDS_BY_NAME: Record<string, number> = {
  ethereum: SupportedChainId.MAINNET,
  arbitrum: SupportedChainId.ARBITRUM_ONE,
  base: SupportedChainId.BASE,
}

// Threshold DAO referrer addresses for fee sharing
export const THRESHOLD_EVM_REFERRER = '0xAEC64338a8cAc51dD74D40Ff745A07798Ddef0ED'

// Minimal ABI for the MayanBridgeHelper contract
export const MAYAN_BRIDGE_HELPER_ABI = [
  {
    name: 'approveAndForward',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'forwarder', type: 'address' },
      { name: 'forwardData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const
