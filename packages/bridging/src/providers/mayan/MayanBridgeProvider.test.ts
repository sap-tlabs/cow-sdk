import { cowAppDataLatestScheme as latestAppData } from '@cowprotocol/sdk-app-data'
import { BridgeStatus, QuoteBridgeRequest } from '../../types'
import { MayanApi } from './MayanApi'
import {
  MAYAN_HOOK_DAPP_ID,
  EXPECTED_FILL_TIME_SECONDS,
  MIN_BRIDGE_AMOUNT,
} from './const/misc'
import {
  MayanBridgeProvider,
  MayanBridgeProviderOptions,
  MayanQuoteResult,
} from './MayanBridgeProvider'
import type { MayanApiQuote } from './types'
import { SupportedChainId, TargetChainId } from '@cowprotocol/sdk-config'
import { OrderKind } from '@cowprotocol/sdk-order-book'
import { createAdapters } from '../../../tests/setup'
import { setGlobalAdapter } from '@cowprotocol/sdk-common'

jest.mock('./MayanApi')

class MayanBridgeProviderTest extends MayanBridgeProvider {
  constructor(options: MayanBridgeProviderOptions) {
    super(options)
  }

  public getApi() {
    return this.api
  }

  public setApi(api: MayanApi) {
    this.api = api
  }
}

const adapters = createAdapters()
const adapterNames = Object.keys(adapters) as Array<keyof typeof adapters>

adapterNames.forEach((adapterName) => {
  describe(`MayanBridgeProvider for ${adapterName}`, () => {
    let provider: MayanBridgeProviderTest

    beforeEach(() => {
      const adapter = adapters[adapterName]
      setGlobalAdapter(adapter)

      const options: MayanBridgeProviderOptions = {}
      provider = new MayanBridgeProviderTest(options)
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
      let mockApi: MayanApi

      beforeEach(() => {
        mockApi = new MayanApi()
        jest.spyOn(mockApi, 'getTokens').mockImplementation(async (chainId) => {
          if (chainId === SupportedChainId.ARBITRUM_ONE) {
            return [
              {
                chainId: SupportedChainId.ARBITRUM_ONE,
                address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
                decimals: 6,
                name: 'USD Coin',
                symbol: 'USDC',
              },
            ]
          }
          return []
        })
        provider.setApi(mockApi)
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

      it('should return tokens for supported cross-chain route', async () => {
        const result = await provider.getBuyTokens({
          sellChainId: SupportedChainId.MAINNET,
          buyChainId: SupportedChainId.ARBITRUM_ONE,
        })

        expect(result.tokens.length).toBeGreaterThan(0)
        expect(result.isRouteAvailable).toBe(true)
        expect(mockApi.getTokens).toHaveBeenCalledWith(SupportedChainId.ARBITRUM_ONE)
      })
    })

    describe('getQuote', () => {
      const mockMayanQuote: MayanApiQuote = {
        type: 'SWIFT',
        effectiveAmountIn: 1.0,
        expectedAmountOut: 0.99,
        minAmountOut: 0.985,
        minReceived: 0.985,
        etaSeconds: 45,
        price: 0.99,
        priceImpact: 0.01,
        swapRelayerFee: 0.002,
        redeemRelayerFee: 0.001,
        refundRelayerFee: 0.001,
        solanaRelayerFee: 0.001,
        deadline64: '1234567890',
        referrerBps: 50,
        protocolBps: 0,
        fromToken: {
          mint: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
          contract: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
          chainId: 1,
          name: 'tBTC v2',
          symbol: 'tBTC',
          decimals: 18,
          logoURI: '',
        },
        toToken: {
          mint: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40',
          contract: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40',
          chainId: 42161,
          name: 'tBTC v2',
          symbol: 'tBTC',
          decimals: 18,
          logoURI: '',
        },
        fromChain: 'ethereum',
        toChain: 'arbitrum',
        _raw: {},
      }

      beforeEach(() => {
        const mockApi = new MayanApi()
        jest.spyOn(mockApi, 'getQuote').mockResolvedValue(mockMayanQuote)
        provider.setApi(mockApi)
      })

      it('should return quote with amounts and fees', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
          sellTokenChainId: SupportedChainId.MAINNET,
          buyTokenChainId: SupportedChainId.ARBITRUM_ONE,
          buyTokenAddress: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40',
          amount: BigInt('1000000000000000000'),
          sellTokenDecimals: 18,
          buyTokenDecimals: 18,
          appCode: '0x123',
          signer: '0xa43ccc40ff785560dab6cb0f13b399d050073e8a54114621362f69444e1421ca',
        }

        const quote = await provider.getQuote(request)

        expect(quote.isSell).toBe(true)
        expect(quote.sourceChainId).toBe(SupportedChainId.MAINNET)
        expect(quote.destChainId).toBe(SupportedChainId.ARBITRUM_ONE)
        expect(quote.mayanQuote).toEqual(mockMayanQuote)
        expect(quote.expectedFillTimeSeconds).toBe(45)
        expect(quote.amountsAndCosts.beforeFee.sellAmount).toBe(BigInt('1000000000000000000'))
        expect(quote.amountsAndCosts.costs.bridgingFee.feeBps).toBe(50)
      })

      it('should throw NO_ROUTES for same-chain', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
          sellTokenChainId: SupportedChainId.MAINNET,
          buyTokenChainId: SupportedChainId.MAINNET,
          buyTokenAddress: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
          amount: BigInt('1000000000000000000'),
          sellTokenDecimals: 18,
          buyTokenDecimals: 18,
          appCode: '0x123',
          signer: '0xa43ccc40ff785560dab6cb0f13b399d050073e8a54114621362f69444e1421ca',
        }

        await expect(provider.getQuote(request)).rejects.toThrow('NO_ROUTES')
      })

      it('should throw SELL_AMOUNT_TOO_SMALL for dust amounts', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
          sellTokenChainId: SupportedChainId.MAINNET,
          buyTokenChainId: SupportedChainId.ARBITRUM_ONE,
          buyTokenAddress: '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40',
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
          dappId: MAYAN_HOOK_DAPP_ID,
          name: 'Mayan',
          type: 'HookBridgeProvider',
          logoUrl: expect.stringContaining('mayan-logo.png'),
          website: 'https://mayan.finance',
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
      it('should return Mayan explorer url', () => {
        expect(provider.getExplorerUrl('0x123abc')).toBe('https://explorer.mayan.finance/swap/0x123abc')
      })
    })

    describe('getStatus', () => {
      beforeEach(() => {
        const mockApi = new MayanApi()
        jest.spyOn(mockApi, 'getStatus').mockResolvedValue({
          status: BridgeStatus.EXECUTED,
          depositTxHash: '0xabc',
          fillTxHash: '0xdef',
        })
        provider.setApi(mockApi)
      })

      it('should return bridge status from API', async () => {
        const status = await provider.getStatus('0xabc', SupportedChainId.MAINNET)

        expect(status.status).toBe(BridgeStatus.EXECUTED)
        expect(status.depositTxHash).toBe('0xabc')
        expect(status.fillTxHash).toBe('0xdef')
      })
    })
  })
})
