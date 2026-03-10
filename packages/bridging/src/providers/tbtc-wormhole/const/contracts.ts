import { SupportedChainId } from '@cowprotocol/sdk-config'

// tBTC ERC-20 token addresses per chain
export const TBTC_TOKEN_ADDRESSES: Partial<Record<SupportedChainId, string>> = {
  [SupportedChainId.MAINNET]: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
  [SupportedChainId.ARBITRUM_ONE]: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40',
  [SupportedChainId.BASE]: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b',
}

// Wormhole Token Bridge (L1 only — used for L1→L2 transfers)
export const TOKEN_BRIDGE_ADDRESS = '0x3ee18B2214AFF97000D974cf647E7C347E8fa585'

// Wormhole Core Bridge — used to read messageFee()
export const WORMHOLE_CORE_ADDRESSES: Partial<Record<SupportedChainId, string>> = {
  [SupportedChainId.MAINNET]: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B',
  [SupportedChainId.ARBITRUM_ONE]: '0xa5f208e072434bC67592E4C49C1B991BA79BCA46',
  [SupportedChainId.BASE]: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8239',
}

// L2WormholeGateway — used for L1→L2 (as recipient) and L2→L1 (as sender)
export const L2_WORMHOLE_GATEWAYS: Partial<Record<SupportedChainId, string>> = {
  [SupportedChainId.ARBITRUM_ONE]: '0x1293a54e160D1cd7075487898d65266081A15458',
  [SupportedChainId.BASE]: '0x09959798B95d00a3183d20FaC298E4594E599eab',
}

// Wormhole chain IDs (not EVM chain IDs)
export const WORMHOLE_CHAIN_IDS: Partial<Record<SupportedChainId, number>> = {
  [SupportedChainId.MAINNET]: 2,
  [SupportedChainId.ARBITRUM_ONE]: 23,
  [SupportedChainId.BASE]: 30,
}

// TbtcBridgeHelper — stateless delegate-call target deployed per chain
// TODO: deploy via Threshold multisig, then fill in addresses
export const TBTC_BRIDGE_HELPER_ADDRESSES: Partial<Record<SupportedChainId, string>> = {
  [SupportedChainId.MAINNET]: '0x0000000000000000000000000000000000000000',
  [SupportedChainId.ARBITRUM_ONE]: '0x0000000000000000000000000000000000000000',
  [SupportedChainId.BASE]: '0x0000000000000000000000000000000000000000',
}

// Minimal ABIs for on-chain reads and call encoding

export const WORMHOLE_CORE_ABI = [
  {
    name: 'messageFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const L2_WORMHOLE_GATEWAY_ABI = [
  {
    name: 'mintingLimit',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'mintedAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const TBTC_BRIDGE_HELPER_ABI = [
  {
    name: 'depositL1ToL2',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'tbtcToken', type: 'address' },
      { name: 'tokenBridge', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipientChain', type: 'uint16' },
      { name: 'gateway', type: 'bytes32' },
      { name: 'nonce', type: 'uint32' },
      { name: 'recipient', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'depositL2ToL1',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'tbtcToken', type: 'address' },
      { name: 'gateway', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'bytes32' },
      { name: 'nonce', type: 'uint32' },
    ],
    outputs: [],
  },
] as const
