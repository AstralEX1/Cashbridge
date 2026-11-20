import { COIN, type HeroState, WORLD, bridgeStart } from './game'

// Everything in the brand greens on near-black.
const BG = '#030907'
const BLOCK = '#0a2219'
const BLOCK_EDGE = '#31fd9d'
const LINK = '#31fd9d'
const LINK_DARK = '#0ac18e'
const MARK = '#04130f'
const SEGMENT = 8

// The bridge is a chain of short links, hinged at the block edge and turned by `angle`.
const drawBridge = (ctx: CanvasRenderingContext2D, x: number, length: number, angle: number) => {
  if (length <= 0) return
  ctx.save()
  ctx.translate(x, WORLD.top)
  ctx.rotate((angle * Math.PI) / 180)
  for (let at = 0, i = 0; at < length; at += SEGMENT, i++) {
    ctx.fillStyle = i % 2 ? LINK_DARK : LINK
    ctx.fillRect(-3, -Math.min(length, at + SEGMENT), 3, Math.min(SEGMENT, length - at))
  }
  ctx.restore()
}

// A coin stamped with a bridge arch; it turns as it rolls.
const drawCoin = (ctx: CanvasRenderingContext2D, x: number, y: number, roll: number) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(roll)
  ctx.shadowColor = '#31fd9d66'
  ctx.shadowBlur = 10
  ctx.fillStyle = LINK
  ctx.beginPath()
  ctx.arc(0, 0, COIN, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = MARK
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(0, 2.4, 4.4, Math.PI, 0)
  ctx.moveTo(-5.2, 2.4)
  ctx.lineTo(5.2, 2.4)
  ctx.stroke()
  ctx.restore()
}

export const drawHero = (ctx: CanvasRenderingContext2D, state: HeroState, scale: number) => {
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, WORLD.width, WORLD.height)
  const glow = ctx.createLinearGradient(0, WORLD.top - 60, 0, WORLD.height)
  glow.addColorStop(0, '#31fd9d00')
  glow.addColorStop(1, '#31fd9d0d')
  ctx.fillStyle = glow
  ctx.fillRect(0, WORLD.top - 60, WORLD.width, WORLD.height)

  const cam = state.camera
  for (const block of state.blocks) {
    const x = block.x - cam
    if (x > WORLD.width || x + block.w < 0) continue
    ctx.fillStyle = BLOCK
    ctx.fillRect(x, WORLD.top, block.w, WORLD.height - WORLD.top)
    ctx.fillStyle = BLOCK_EDGE
    ctx.fillRect(x, WORLD.top, block.w, 2)
  }
  if (state.laid) drawBridge(ctx, state.laid.x - cam, state.laid.length, 90)
  drawBridge(ctx, bridgeStart(state) - cam, state.bridge, state.angle)
  drawCoin(ctx, state.coinX - cam, WORLD.top - COIN - 1 + state.coinY, state.roll)
}
