import { cowAppDataLatestScheme as latestAppData } from '@cowprotocol/sdk-app-data'
import { BridgeStatus, QuoteBridgeRequest } from '../../types'
import { TbtcWormholeApi } from './TbtcWormholeApi'
import {
  TBTC_HOOK_DAPP_ID,
  EXPECTED_FILL_TIME_SECONDS,
  MIN_BRIDGE_AMOUNT,
} from './const/misc'
import {
  TBTC_TOKEN_ADDRESSES,
} from './const/contracts'
import {
  TbtcWormholeBridgeProvider,
  TbtcWormholeBridgeProviderOptions,
  TbtcQuoteResult,
} from './TbtcWormholeBridgeProvider'
import { SupportedChainId, TargetChainId } from '@cowprotocol/sdk-config'
import { OrderKind } from '@cowprotocol/sdk-order-book'
import { createAdapters } from '../../../tests/setup'
import { setGlobalAdapter, AbstractProviderAdapter } from '@cowprotocol/sdk-common'

jest.mock('./TbtcWormholeApi')

class TbtcWormholeBridgeProviderTest extends TbtcWormholeBridgeProvider {
  constructor(options: TbtcWormholeBridgeProviderOptions) {
    super(options)
  }

  public getApi() {
    return this.api
  }

  public setApi(api: TbtcWormholeApi) {
    this.api = api
  }
}

const adapters = createAdapters()
const adapterNames = Object.keys(adapters) as Array<keyof typeof adapters>

const mockReadContract = jest.fn()

adapterNames.forEach((adapterName) => {
  describe(`TbtcWormholeBridgeProvider for ${adapterName}`, () => {
    let provider: TbtcWormholeBridgeProviderTest

    beforeEach(() => {
      const adapter = adapters[adapterName]

      // Mock readContract for on-chain calls (messageFee, mintingLimit, etc.)
      adapter.readContract = mockReadContract
      mockReadContract.mockImplementation(async (params: { functionName: string }) => {
        if (params.functionName === 'messageFee') return '0'
        if (params.functionName === 'mintingLimit') return '100000000000000000000'
        if (params.functionName === 'mintedAmount') return '50000000000000000000'
        return '0'
      })

      setGlobalAdapter(adapter)

      const options: TbtcWormholeBridgeProviderOptions = {}
      provider = new TbtcWormholeBridgeProviderTest(options)
    })

    afterEach(() => {
      jest.clearAllMocks()
    })

    describe('getNetworks', () => {
      it('should return supported networks', async () => {
        const networks = await provider.getNetworks()

        expect(networks.length).toBe(3)
        expect(networks.map((n) => n.id)).toEqual([1, 42161, 8453])
      })
    })

    describe('getBuyTokens', () => {
      it('should return tBTC token for supported chain', async () => {
        const result = await provider.getBuyTokens({
          sellChainId: SupportedChainId.MAINNET,
          buyChainId: SupportedChainId.ARBITRUM_ONE,
        })

        expect(result.tokens.length).toBe(1)
        expect(result.isRouteAvailable).toBe(true)
        expect(result.tokens[0].symbol).toBe('tBTC')
        expect(result.tokens[0].address).toBe(TBTC_TOKEN_ADDRESSES[SupportedChainId.ARBITRUM_ONE])
      })

      it('should return empty for unsupported chain', async () => {
        const result = await provider.getBuyTokens({ buyChainId: 12345 as TargetChainId })

        expect(result.tokens).toEqual([])
        expect(result.isRouteAvailable).toBe(false)
      })

      it('should return empty for same-chain route', async () => {
        const result = await provider.getBuyTokens({
          sellChainId: SupportedChainId.MAINNET,
          buyChainId: SupportedChainId.MAINNET,
        })

        expect(result.tokens).toEqual([])
        expect(result.isRouteAvailable).toBe(false)
      })

      it('should return empty for L2-to-L2 (unsupported)', async () => {
        const result = await provider.getBuyTokens({
          sellChainId: SupportedChainId.ARBITRUM_ONE,
          buyChainId: SupportedChainId.BASE,
        })

        expect(result.tokens).toEqual([])
        expect(result.isRouteAvailable).toBe(false)
      })
    })

    describe('getQuote', () => {
      it('should return 1:1 quote for L1 to L2', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.MAINNET]!,
          sellTokenChainId: SupportedChainId.MAINNET,
          buyTokenChainId: SupportedChainId.ARBITRUM_ONE,
          buyTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.ARBITRUM_ONE]!,
          amount: BigInt('1000000000000000000'),
          sellTokenDecimals: 18,
          buyTokenDecimals: 18,
          appCode: '0x123',
          signer: '0xa43ccc40ff785560dab6cb0f13b399d050073e8a54114621362f69444e1421ca',
        }

        const quote = await provider.getQuote(request)

        expect(quote.isSell).toBe(true)
        expect(quote.bridgeDirection).toBe('L1_TO_L2')
        expect(quote.sourceChainId).toBe(SupportedChainId.MAINNET)
        expect(quote.destChainId).toBe(SupportedChainId.ARBITRUM_ONE)
        // 1:1 bridge: buy amount equals sell amount
        expect(quote.amountsAndCosts.beforeFee.buyAmount).toBe(BigInt('1000000000000000000'))
        expect(quote.amountsAndCosts.costs.bridgingFee.feeBps).toBe(0)
        expect(quote.remainingMintingCapacity).toBe(BigInt('50000000000000000000'))
      })

      it('should return quote for L2 to L1', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.ARBITRUM_ONE]!,
          sellTokenChainId: SupportedChainId.ARBITRUM_ONE,
          buyTokenChainId: SupportedChainId.MAINNET,
          buyTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.MAINNET]!,
          amount: BigInt('1000000000000000000'),
          sellTokenDecimals: 18,
          buyTokenDecimals: 18,
          appCode: '0x123',
          signer: '0xa43ccc40ff785560dab6cb0f13b399d050073e8a54114621362f69444e1421ca',
        }

        const quote = await provider.getQuote(request)

        expect(quote.bridgeDirection).toBe('L2_TO_L1')
        expect(quote.remainingMintingCapacity).toBeNull()
      })

      it('should throw for same-chain route', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.MAINNET]!,
          sellTokenChainId: SupportedChainId.MAINNET,
          buyTokenChainId: SupportedChainId.MAINNET,
          buyTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.MAINNET]!,
          amount: BigInt('1000000000000000000'),
          sellTokenDecimals: 18,
          buyTokenDecimals: 18,
          appCode: '0x123',
          signer: '0xa43ccc40ff785560dab6cb0f13b399d050073e8a54114621362f69444e1421ca',
        }

        await expect(provider.getQuote(request)).rejects.toThrow()
      })

      it('should throw SELL_AMOUNT_TOO_SMALL for tiny amounts', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.MAINNET]!,
          sellTokenChainId: SupportedChainId.MAINNET,
          buyTokenChainId: SupportedChainId.ARBITRUM_ONE,
          buyTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.ARBITRUM_ONE]!,
          amount: 0n,
          sellTokenDecimals: 18,
          buyTokenDecimals: 18,
          appCode: '0x123',
          signer: '0xa43ccc40ff785560dab6cb0f13b399d050073e8a54114621362f69444e1421ca',
        }

        await expect(provider.getQuote(request)).rejects.toThrow('SELL_AMOUNT_TOO_SMALL')
      })
    })

    describe('info', () => {
      it('should return provider info', () => {
        expect(provider.info).toEqual({
          dappId: TBTC_HOOK_DAPP_ID,
          name: 'tBTC Wormhole',
          type: 'HookBridgeProvider',
          logoUrl: expect.stringContaining('tbtc-logo.png'),
          website: 'https://threshold.network',
        })
      })
    })

    describe('decodeBridgeHook', () => {
      it('should throw error as not implemented', async () => {
        await expect(provider.decodeBridgeHook({} as unknown as latestAppData.CoWHook)).rejects.toThrowError(
          'Not implemented',
        )
      })
    })

    describe('getExplorerUrl', () => {
      it('should return WormholeScan url', () => {
        expect(provider.getExplorerUrl('0x123abc')).toBe('https://wormholescan.io/#/tx/0x123abc')
      })
    })

    describe('getStatus', () => {
      beforeEach(() => {
        const mockApi = new TbtcWormholeApi()
        jest.spyOn(mockApi, 'getStatus').mockResolvedValue({
          status: BridgeStatus.EXECUTED,
          depositTxHash: '0xabc',
        })
        provider.setApi(mockApi)
      })

      it('should return bridge status from API', async () => {
        const status = await provider.getStatus('0xabc', SupportedChainId.MAINNET)

        expect(status.status).toBe(BridgeStatus.EXECUTED)
        expect(status.depositTxHash).toBe('0xabc')
      })
    })
  })
})
