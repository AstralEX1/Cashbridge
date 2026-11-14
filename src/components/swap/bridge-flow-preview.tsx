'use client'

import { useState } from 'react'
import { Chain } from '@tcswap/core'
import { BchMark, PusdMark } from '@/components/swap/bridge-marks'
import { BridgeFlow, CauldronQuoteBlock, type FlowStage, type FlowToast } from '@/components/swap/pusd-swap'

// Development only (`?bridgeFlowPreview=<stage>` on the swap page): the progress screen's stages
// from fixed example figures, to look at them without an operation in flight. The real screen reads
// the operation's own figures.
const ETH_ICON = (
  <span className="bridge-flow-icon">
    <img src="/networks/eth.svg" width={30} height={30} alt="" />
  </span>
)

export const BridgeFlowPreview = ({ stage = 'bridging' }: { stage?: string }) => {
  const [dismissed, setDismissed] = useState<string[]>([])
  const flow = (['bridging', 'ready', 'plain', 'swapping', 'done', 'ended'] as FlowStage[]).includes(stage as FlowStage) ? (stage as FlowStage) : 'bridging'
  const pusd = flow !== 'plain'
  const received = flow !== 'bridging' && flow !== 'plain'
  const toasts: FlowToast[] = [
    ...(received ? [{ id: 'receive', title: 'BCH received', hash: 'b7d0e2c4f1a9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f541c8', chain: Chain.BitcoinCash }] : []),
    { id: 'send', title: 'Send Tx submitted', hash: '0x5e1c7d2b9a8f6e4c3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a2918070a9f2', chain: Chain.Base, time: '19:11' }
  ].filter(t => !dismissed.includes(t.id))

  return (
    <div className="bridge-flow-layer" role="dialog" aria-label="Bridge progress preview">
      <BridgeFlow
        stage={flow}
        title="Preview"
        sourceChain={Chain.Base}
        sourceAddress="0x76ff6F88f58e083b88A80B1764ae7002e303D1A6"
        bchAddress="bitcoincash:qp4qeeh8m6zd8r2yq7h0j3k5x9w2v4u6t8s0rm8w9z"
        sent={{ amount: '0.001', ticker: 'ETH', usd: '$2.31', icon: ETH_ICON }}
        bch={{ amount: received ? '0.0072956' : '≈ 0.0073', ticker: 'BCH', usd: '$2.05', icon: <BchMark size={30} /> }}
        pusd={pusd ? { amount: '≈ 2.04', ticker: 'PUSD', usd: '$2.03', icon: <PusdMark size={30} /> } : undefined}
        bridgeBar={received ? { fill: 1, done: true } : { fill: 0.6, eta: '≈ 2 min', live: true }}
        swapBar={pusd ? (flow === 'swapping' ? { fill: 0.6, live: true, eta: '≈ 40 s' } : flow === 'done' ? { fill: 1, done: true } : { fill: 0, eta: '≈ 1 min' }) : undefined}
        details={
          flow === 'ready' ? (
            <CauldronQuoteBlock
              quote={{
                bchPerPusd: 0.0035565,
                pusdUsd: 0.997,
                lpFeePercent: 0.3,
                lpFeeUsd: 0.006,
                networkFeeBch: 0.0000031,
                networkFeeUsd: 0.0009,
                priceImpactPercent: 0.44,
                minimum: '2.02 PUSD'
              }}
            />
          ) : undefined
        }
        actions={
          flow === 'ready' ? (
            <>
              <button type="button" className="bridge-flow-primary is-active">
                Swap BCH → PUSD (2/2)
              </button>
              <button type="button" className="bridge-flow-link">
                Keep BCH instead
              </button>
            </>
          ) : flow === 'bridging' || flow === 'plain' ? (
            <button type="button" className="bridge-flow-primary" disabled>
              <svg className="bridge-flow-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="#3a4f59" />
                <path d="M12 3a9 9 0 019 9" stroke="#0ac18e" />
              </svg>
              {flow === 'plain' ? 'Bridging to BCH…' : 'Swap BCH → PUSD (2/2)'}
            </button>
          ) : undefined
        }
        toasts={toasts}
        onDismissToast={id => setDismissed(list => [...list, id])}
        onHistory={() => {}}
        onClose={() => {}}
      />
    </div>
  )
}
