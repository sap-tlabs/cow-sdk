import { HOOK_DAPP_BRIDGE_PROVIDER_PREFIX } from '../../../const'

export const MAYAN_HOOK_DAPP_ID = `${HOOK_DAPP_BRIDGE_PROVIDER_PREFIX}/mayan`

// Mayan API endpoints
export const MAYAN_PRICE_API_BASE = 'https://price-api.mayan.finance/v3'
export const MAYAN_EXPLORER_API_BASE = 'https://explorer-api.mayan.finance/v3'

// Mayan Swift typically fills in under 1 minute
export const EXPECTED_FILL_TIME_SECONDS = 60

// Default slippage for Mayan quotes (0.5%)
export const DEFAULT_SLIPPAGE_BPS = 50

// Referrer fee in bps (Mayan matches, so total user cost = 2x this)
export const REFERRER_BPS = 50

// Minimum bridge amount: $1 equivalent (varies by token, use conservative floor)
export const MIN_BRIDGE_AMOUNT = 1n

// Quote timeout in milliseconds
export const QUOTE_TIMEOUT_MS = 10_000

// Mayan tokens API
export const MAYAN_TOKENS_API_BASE = 'https://price-api.mayan.finance/v3/tokens'
