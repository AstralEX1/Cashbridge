import { drawCharacter } from '@/components/bridge-hero/characters'
import { BLOCKS_PER_WORLD, THEMES, drawScene, worldAt } from '@/components/bridge-hero/scene'
import { CASH, type HeroState, REST_Y, WORLD, bridgeStart } from '@/components/bridge-hero/game'
import type { CharacterId } from '@/components/bridge-hero/wallet'

const SEGMENT = 8

// The bridge is a chain of short links, hinged at the block edge and turned by `angle`.
const drawBridge = (ctx: CanvasRenderingContext2D, x: number, length: number, angle: number, color: string) => {
  if (length <= 0) return
  ctx.save()
  ctx.translate(x, WORLD.top)
  ctx.rotate((angle * Math.PI) / 180)
  for (let at = 0, i = 0; at < length; at += SEGMENT, i++) {
    ctx.fillStyle = color
    ctx.globalAlpha = i % 2 ? 0.7 : 1
    ctx.fillRect(-3, -Math.min(length, at + SEGMENT), 3, Math.min(SEGMENT, length - at))
  }
  ctx.restore()
}

// The BCH coin to pick up: green, with a tilted B, floating over the gap.
const drawCash = (ctx: CanvasRenderingContext2D, x: number, y: number, time: number) => {
  ctx.save()
  ctx.translate(x, y + Math.sin(time * 3 + x) * 1.5)
  ctx.shadowColor = '#0ac18e'
  ctx.shadowBlur = 8
  ctx.fillStyle = '#0ac18e'
  ctx.beginPath()
  ctx.arc(0, 0, CASH, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.rotate(-0.3)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 7px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('B', 0, 0.5)
  ctx.restore()
}

export type HeroLook = { start: number; character: CharacterId; time: number }

export const drawHero = (ctx: CanvasRenderingContext2D, state: HeroState, scale: number, look: HeroLook) => {
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  const cam = state.camera
  const world = THEMES[worldAt(look.start, state.score)]
  // Crossing into a new world fades its sky in while the view slides.
  const entering = state.slide && state.score > 0 && state.score % BLOCKS_PER_WORLD === 0
  if (entering) {
    drawScene(ctx, THEMES[worldAt(look.start, state.score - 1)], cam, look.time)
    ctx.globalAlpha = state.slide!.t
  }
  drawScene(ctx, world, cam, look.time)
  ctx.globalAlpha = 1

  for (const block of state.blocks) {
    const x = block.x - cam
    if (x > WORLD.width || x + block.w < 0) continue
    ctx.fillStyle = world.block
    ctx.fillRect(x, WORLD.top, block.w, WORLD.height - WORLD.top)
    ctx.fillStyle = world.edge
    ctx.fillRect(x, WORLD.top, block.w, 2)
  }
  if (state.laid) drawBridge(ctx, state.laid.x - cam, state.laid.length, 90, world.edge)
  drawBridge(ctx, bridgeStart(state) - cam, state.bridge, state.angle, world.edge)
  for (const cash of state.cash) drawCash(ctx, cash.x - cam, cash.y, look.time)
  drawCharacter(ctx, look.character, state.coinX - cam, REST_Y - state.hop + state.coinY, state.roll)
}
