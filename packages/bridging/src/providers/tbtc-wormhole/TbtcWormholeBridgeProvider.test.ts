import { cowAppDataLatestScheme as latestAppData } from '@cowprotocol/sdk-app-data'
import { BridgeStatus, QuoteBridgeRequest } from '../../types'
import { TbtcWormholeApi } from './TbtcWormholeApi'
import {
  TBTC_HOOK_DAPP_ID,
  MIN_BRIDGE_AMOUNT,
} from './const/misc'
import {
  TBTC_TOKEN_ADDRESSES,
} from './const/contracts'
import {
  TbtcWormholeBridgeProvider,
  TbtcWormholeBridgeProviderOptions,
} from './TbtcWormholeBridgeProvider'
import { SupportedChainId, TargetChainId } from '@cowprotocol/sdk-config'
import { OrderKind } from '@cowprotocol/sdk-order-book'
import { createAdapters } from '../../../tests/setup'
import { setGlobalAdapter } from '@cowprotocol/sdk-common'

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
        expect(quote.amountsAndCosts.beforeFee.buyAmount).toBe(BigInt('1000000000000000000'))
        // tBTC bridge has zero token fee (message fee is in ETH, not tBTC)
        expect(quote.amountsAndCosts.costs.bridgingFee.feeBps).toBe(0)
        expect(quote.amountsAndCosts.costs.bridgingFee.amountInSellCurrency).toBe(0n)
        expect(quote.amountsAndCosts.costs.bridgingFee.amountInBuyCurrency).toBe(0n)
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

      it('should throw ONLY_SELL_ORDER_SUPPORTED for BUY orders', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.BUY,
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

        await expect(provider.getQuote(request)).rejects.toThrow('ONLY_SELL_ORDER_SUPPORTED')
      })

      it('should reject when amount exceeds minting capacity', async () => {
        const request: QuoteBridgeRequest = {
          kind: OrderKind.SELL,
          sellTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.MAINNET]!,
          sellTokenChainId: SupportedChainId.MAINNET,
          buyTokenChainId: SupportedChainId.ARBITRUM_ONE,
          buyTokenAddress: TBTC_TOKEN_ADDRESSES[SupportedChainId.ARBITRUM_ONE]!,
          amount: BigInt('100000000000000000000'), // 100 tBTC, exceeds 50 tBTC capacity
          sellTokenDecimals: 18,
          buyTokenDecimals: 18,
          appCode: '0x123',
          signer: '0xa43ccc40ff785560dab6cb0f13b399d050073e8a54114621362f69444e1421ca',
        }

        await expect(provider.getQuote(request)).rejects.toThrow('NO_ROUTES')
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

    describe('TbtcWormholeApi', () => {
      describe('extractSequenceFromReceipt', () => {
        // Use the real implementation, not the jest mock
        const { TbtcWormholeApi: RealTbtcWormholeApi } = jest.requireActual('./TbtcWormholeApi') as typeof import('./TbtcWormholeApi')
        const api = new RealTbtcWormholeApi()

        it('should extract sequence from log data (not topics)', () => {
          const LOG_TOPIC = '0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2'
          const mockReceipt = {
            logs: [
              {
                topics: [
                  LOG_TOPIC,
                  '0x0000000000000000000000003ee18b2214aff97000d974cf647e7c347e8fa585', // sender (indexed)
                ] as readonly string[],
                // sequence = 42, ABI-encoded as uint256
                data: '0x000000000000000000000000000000000000000000000000000000000000002a' +
                  '0000000000000000000000000000000000000000000000000000000000000000' +
                  '0000000000000000000000000000000000000000000000000000000000000000',
              },
            ],
          }

          const sequence = api.extractSequenceFromReceipt(mockReceipt)
          expect(sequence).toBe('42')
        })

        it('should return null when no matching log', () => {
          const mockReceipt = {
            logs: [
              {
                topics: ['0xdeadbeef'] as readonly string[],
                data: '0x',
              },
            ],
          }

          const sequence = api.extractSequenceFromReceipt(mockReceipt)
          expect(sequence).toBeNull()
        })

        it('should return null when data is too short', () => {
          const LOG_TOPIC = '0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2'
          const mockReceipt = {
            logs: [
              {
                topics: [LOG_TOPIC] as readonly string[],
                data: '0x00',
              },
            ],
          }

          const sequence = api.extractSequenceFromReceipt(mockReceipt)
          expect(sequence).toBeNull()
        })
      })
    })
  })
})
