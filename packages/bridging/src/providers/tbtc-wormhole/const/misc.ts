import { HOOK_DAPP_BRIDGE_PROVIDER_PREFIX } from '../../../const'

export const TBTC_HOOK_DAPP_ID = `${HOOK_DAPP_BRIDGE_PROVIDER_PREFIX}/tbtc-wormhole`

export const TBTC_DECIMALS = 18

// Wormhole VAA typically attested within ~15 minutes on EVM chains
export const EXPECTED_FILL_TIME_SECONDS = 900

export const WORMHOLE_SCAN_BASE_URL = 'https://api.wormholescan.io'

// LogMessagePublished(address sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)
export const LOG_MESSAGE_PUBLISHED_TOPIC = '0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2'

// 0.001 tBTC minimum (~$60 at $60k BTC)
export const MIN_BRIDGE_AMOUNT = 1_000_000_000_000_000n

// 100 tBTC fallback max (real max comes from L2 gateway minting capacity)
export const FALLBACK_MAX_BRIDGE_AMOUNT = 100_000_000_000_000_000_000n
