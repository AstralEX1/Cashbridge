import { ReactNode, useId } from 'react'
import { Info } from 'lucide-react'

// Small shared pieces of the bridge's confirm and progress screens.

export const ThorchainMark = ({ size = 20 }: { size?: number }) => (
  <img src="/providers/thorchain.svg" width={size} height={size} alt="THORChain" className="bridge-mark" />
)

// Cauldron's own logo (app.cauldron.quest favicon, see public/tokens/README.md).
export const CauldronMark = ({ size = 20 }: { size?: number }) => (
  <img src="/providers/cauldron.png" width={size} height={size} alt="Cauldron" className="bridge-mark" />
)

// ParyonUSD's icon from its BCMR metadata (see public/tokens/README.md).
export const PusdMark = ({ size = 34 }: { size?: number }) => (
  <img src="/tokens/pusd.svg" width={size} height={size} alt="" className="bridge-mark bridge-pusd-mark" />
)

export const BchMark = ({ size = 34 }: { size?: number }) => <img src="/networks/bch.svg" width={size} height={size} alt="" className="bridge-mark" />

// A labelled value whose details show on hover or keyboard focus.
export const HoverCard = ({ label, children, align = 'end' }: { label: ReactNode; children: ReactNode; align?: 'start' | 'end' }) => {
  const id = useId()
  return (
    <span className="bridge-tip-host" data-align={align}>
      <button type="button" className="bridge-tip-trigger" aria-describedby={id}>
        {label}
        <Info size={16} className="bridge-tip-icon" aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} className="bridge-tip">
        {children}
      </span>
    </span>
  )
}
