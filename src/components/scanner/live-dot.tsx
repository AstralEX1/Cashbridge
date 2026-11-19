// Pulses while the Router feed answers; grey when it cannot be reached.
export function LiveDot({ live }: { live?: boolean }) {
  const label = live === undefined ? 'Connecting' : live ? 'Live' : 'Offline'
  return <span className="live-dot" data-live={live} role="img" aria-label={label} title={label} />
}
