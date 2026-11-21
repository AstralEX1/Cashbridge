import type { FigLeg, FigNode, Figure } from '@/components/docs/route-figure'

// Every route the bridge runs, as figures for the docs: into or out of Bitcoin Cash, Manual or the Cashbridge Router,
// through THORChain, NEAR Intents or ShapeShift. The sample asset is USDC on Base and the token is PUSD.

export type Direction = 'in' | 'out'
export type Mode = 'manual' | 'router'
export type BridgeId = 'thorchain' | 'near' | 'shapeshift' | 'any'

export const LOGO = {
  usdc: '/tokens/usdc.svg',
  pusd: '/tokens/pusd.svg',
  bch: '/networks/bch.svg',
  base: '/networks/base.svg',
  thorchain: '/providers/thorchain.svg',
  near: '/providers/near.svg',
  shapeshift: '/providers/shapeshift.svg',
  cauldron: '/providers/cauldron.png'
}

const BCH = 'Bitcoin Cash'

const BRIDGE: Record<BridgeId, { name: string; node: Omit<FigNode, 'id' | 'kind'>; pays: string; deposit: string; sale: string }> = {
  thorchain: {
    name: 'THORChain',
    node: { label: 'THORChain', sub: 'vault + memo', logo: LOGO.thorchain },
    pays: 'THORChain pays native BCH',
    deposit: "to THORChain's vault, with a memo that names the BCH address",
    sale: "to THORChain's vault with your swap memo"
  },
  near: {
    name: 'NEAR Intents',
    node: { label: 'NEAR Intents', sub: 'one-use address', logo: LOGO.near },
    pays: 'NEAR Intents pays native BCH',
    deposit: 'as a plain transfer to a one-use NEAR Intents address',
    sale: 'to the NEAR Intents deposit address'
  },
  shapeshift: {
    name: 'ShapeShift',
    node: { label: 'ShapeShift', sub: 'one-use address', logo: LOGO.shapeshift },
    pays: 'ShapeShift pays native BCH (a NEAR Intents swap underneath)',
    deposit: 'as a plain transfer to a ShapeShift deposit address',
    sale: 'to the ShapeShift deposit address, the exact amount, the rest back to you'
  },
  any: {
    name: 'the bridge',
    node: { label: 'Any of 3 bridges', sub: 'best quote wins', logos: [LOGO.thorchain, LOGO.near, LOGO.shapeshift] },
    pays: 'THORChain, NEAR Intents or ShapeShift pays native BCH',
    deposit: 'to whichever bridge quoted best',
    sale: "to the bridge in the sale's terms"
  }
}

export type RouteScene = {
  figure: Figure
  signatures: string
  custody: string
  failure: string
}

const yourWallet = (id: string, sub: string, extra: Partial<FigNode> = {}): FigNode => ({
  id,
  label: 'Your wallet',
  sub,
  logo: LOGO.usdc,
  badge: LOGO.base,
  kind: 'wallet',
  zone: 'Base',
  ...extra
})

const cauldron = (sub?: string, extra: Partial<FigNode> = {}): FigNode => ({ id: 'pool', label: 'Cauldron', sub, logo: LOGO.cauldron, kind: 'pool', zone: BCH, ...extra })

export function routeScene(direction: Direction, mode: Mode, bridgeId: BridgeId): RouteScene {
  const b = BRIDGE[bridgeId]
  const bridge: FigNode = { id: 'bridge', kind: 'bridge', ...b.node }
  const manual = mode === 'manual'
  let nodes: FigNode[]
  let legs: FigLeg[]

  if (direction === 'in' && manual) {
    nodes = [
      yourWallet('src', 'USDC on Base', { sign: true }),
      bridge,
      { id: 'bch', label: 'Your BCH wallet', sub: 'signs the swap', logo: LOGO.bch, kind: 'wallet', sign: true, zone: BCH },
      cauldron('BCH → PUSD'),
      { id: 'out', label: 'Your BCH wallet', sub: 'holds the PUSD', logo: LOGO.pusd, badge: LOGO.bch, kind: 'wallet', zone: BCH }
    ]
    legs = [
      { from: 'src', to: 'bridge', coin: LOGO.usdc, step: `You sign the deposit ${b.deposit}.` },
      { from: 'bridge', to: 'bch', coin: LOGO.bch, step: `${b.pays} to your BCH wallet.` },
      { from: 'bch', to: 'pool', coin: LOGO.bch, step: 'Your BCH wallet signs a Cauldron swap.' },
      { from: 'pool', to: 'out', coin: LOGO.pusd, step: 'The PUSD lands in the same wallet.' }
    ]
  } else if (direction === 'in') {
    nodes = [
      yourWallet('src', 'signs once', { sign: true }),
      bridge,
      { id: 'contract', label: 'Order contract', sub: 'made for this order', kind: 'contract', zone: BCH },
      cauldron('page or Router key'),
      { id: 'out', label: 'Your address', sub: 'PUSD, at least the min', logo: LOGO.pusd, badge: LOGO.bch, kind: 'wallet', zone: BCH }
    ]
    legs = [
      {
        from: 'src',
        to: 'bridge',
        coin: LOGO.usdc,
        step: `Your one signature: the deposit ${b.deposit}.${bridgeId === 'thorchain' ? ' An ERC-20 token may need an approval first.' : ''}`
      },
      { from: 'bridge', to: 'contract', coin: LOGO.bch, step: `${b.pays} to a contract built from your order's terms.` },
      { from: 'contract', to: 'pool', coin: LOGO.bch, step: 'Your page trades it on Cauldron the moment it lands; the Cashbridge Router does if the tab is closed.' },
      { from: 'pool', to: 'out', coin: LOGO.pusd, step: 'At least the quoted minimum of PUSD reaches your address.' },
      { from: 'contract', to: 'out', back: 'or the BCH back to you' }
    ]
  } else if (manual) {
    nodes = [
      { id: 'src', label: 'Your BCH wallet', sub: 'signs the sale', logo: LOGO.pusd, badge: LOGO.bch, kind: 'wallet', sign: true, zone: BCH },
      cauldron('PUSD → BCH'),
      { id: 'bch', label: 'Your BCH wallet', sub: 'signs the deposit', logo: LOGO.bch, kind: 'wallet', sign: true, zone: BCH },
      bridge,
      yourWallet('dst', 'USDC on Base')
    ]
    legs = [
      { from: 'src', to: 'pool', coin: LOGO.pusd, step: 'Your BCH wallet signs the Cauldron sale.' },
      { from: 'pool', to: 'bch', coin: LOGO.bch, step: 'The BCH comes back to your wallet.' },
      { from: 'bch', to: 'bridge', coin: LOGO.bch, step: `Your BCH wallet signs the deposit ${b.deposit}.` },
      { from: 'bridge', to: 'dst', coin: LOGO.usdc, step: `${b.name === 'the bridge' ? 'The bridge' : b.name} pays USDC on Base.` }
    ]
  } else {
    nodes = [
      { id: 'src', label: 'Your BCH wallet', sub: 'signs once', logo: LOGO.pusd, badge: LOGO.bch, kind: 'wallet', sign: true, zone: BCH },
      { id: 'contract', label: 'Sale contract', sub: 'made for this sale', kind: 'contract', zone: BCH },
      cauldron(undefined, { above: 'contract', zone: undefined }),
      { ...bridge, sub: bridgeId === 'shapeshift' ? 'exact amount' : bridge.sub },
      yourWallet('dst', 'USDC on Base')
    ]
    legs = [
      { from: 'src', to: 'contract', coin: LOGO.pusd, step: 'Your one signature: the PUSD to a contract made for this sale.' },
      { from: 'contract', to: 'pool', coin: LOGO.pusd, loop: true, step: 'The Cashbridge Router sells it on Cauldron…' },
      { from: 'pool', to: 'contract', coin: LOGO.bch, loop: true, step: '…and the BCH comes back into the same contract.' },
      { from: 'contract', to: 'bridge', coin: LOGO.bch, step: `The contract deposits it ${b.sale}.` },
      { from: 'bridge', to: 'dst', coin: LOGO.usdc, step: `${b.name === 'the bridge' ? 'The bridge' : b.name} pays USDC on Base.` },
      { from: 'contract', to: 'src', back: 'or the PUSD back' }
    ]
  }

  const label = legs
    .filter(leg => leg.step)
    .map((leg, i) => `${i + 1}. ${leg.step}`)
    .join(' ')
  const refund =
    bridgeId === 'thorchain' ? 'THORChain refunds the source asset' : bridgeId === 'any' ? 'The bridge refunds the source asset' : `${b.name} refunds your source wallet`
  return {
    figure: { label, nodes, legs },
    signatures: manual ? '2' : direction === 'in' && bridgeId === 'thorchain' ? '1 (+ approval)' : '1',
    custody: manual ? 'Your wallets only' : direction === 'in' ? 'A contract for this order' : 'A contract for this sale',
    failure: manual
      ? direction === 'in'
        ? refund
        : 'The bridge refunds the BCH to your wallet'
      : direction === 'in'
        ? 'BCH back to you; after 3 h anyone can send it'
        : 'PUSD back to you; after 3 h anyone can send it'
  }
}
