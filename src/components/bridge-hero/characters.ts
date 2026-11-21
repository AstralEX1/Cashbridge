import { COIN } from '@/components/bridge-hero/game'
import type { CharacterId } from '@/components/bridge-hero/wallet'

// Our own little cast, drawn at the hero's radius around (0, 0). Coins and the block turn as they
// roll; the others stay upright and bob along.
const R = COIN

const coin = (ctx: CanvasRenderingContext2D, face: string, mark: string, glow: string) => {
  ctx.shadowColor = glow
  ctx.shadowBlur = 10
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = mark
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(0, 2.4, 4.4, Math.PI, 0)
  ctx.moveTo(-5.2, 2.4)
  ctx.lineTo(5.2, 2.4)
  ctx.stroke()
}

const eyes = (ctx: CanvasRenderingContext2D, y: number, gap: number, color = '#04130f') => {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(-gap, y, 1.3, 0, Math.PI * 2)
  ctx.arc(gap, y, 1.3, 0, Math.PI * 2)
  ctx.fill()
}

const DRAW: Record<CharacterId, (ctx: CanvasRenderingContext2D, roll: number) => void> = {
  cash: (ctx, roll) => {
    ctx.rotate(roll)
    coin(ctx, '#31fd9d', '#04130f', '#31fd9d66')
  },
  gold: (ctx, roll) => {
    ctx.rotate(roll)
    coin(ctx, '#ffd04d', '#5a3b00', '#ffd04d77')
  },
  jelly: ctx => {
    ctx.fillStyle = '#31fd9d'
    ctx.beginPath()
    ctx.moveTo(-R, R)
    ctx.quadraticCurveTo(-R - 1, -R - 1, 0, -R)
    ctx.quadraticCurveTo(R + 1, -R - 1, R, R)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#ffffff99'
    ctx.beginPath()
    ctx.ellipse(-3.6, -4, 1.6, 2.4, -0.5, 0, Math.PI * 2)
    ctx.fill()
    eyes(ctx, -0.5, 2.6)
  },
  block: (ctx, roll) => {
    ctx.rotate(roll)
    ctx.fillStyle = '#0ac18e'
    ctx.fillRect(-R + 0.5, -R + 0.5, R * 2 - 1, R * 2 - 1)
    ctx.strokeStyle = '#04130f'
    ctx.lineWidth = 1.4
    ctx.strokeRect(-3.5, -3.5, 7, 7)
    ctx.fillStyle = '#31fd9d'
    ctx.fillRect(-R + 0.5, -R + 0.5, R * 2 - 1, 2)
  },
  cat: ctx => {
    ctx.fillStyle = '#ff9f43'
    ctx.beginPath()
    ctx.moveTo(-7, -3)
    ctx.lineTo(-6, -10)
    ctx.lineTo(-1.5, -6)
    ctx.moveTo(7, -3)
    ctx.lineTo(6, -10)
    ctx.lineTo(1.5, -6)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(0, 0.5, R - 0.5, 0, Math.PI * 2)
    ctx.fill()
    eyes(ctx, -0.5, 3)
    ctx.fillStyle = '#04130f'
    ctx.fillRect(-0.8, 2, 1.6, 1.2)
  },
  astro: ctx => {
    ctx.fillStyle = '#eef4ff'
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0d1b2a'
    ctx.beginPath()
    ctx.roundRect(-5.5, -3.5, 11, 7, 3.5)
    ctx.fill()
    ctx.fillStyle = '#31fd9d'
    ctx.fillRect(-3.5, -2, 2.5, 1.2)
    ctx.fillStyle = '#ff6b6b'
    ctx.fillRect(-0.8, -R - 2.5, 1.6, 2.5)
  }
}

const UPRIGHT: CharacterId[] = ['jelly', 'cat', 'astro']

export const drawCharacter = (ctx: CanvasRenderingContext2D, id: CharacterId, x: number, y: number, roll: number) => {
  ctx.save()
  // Upright characters take small steps instead of turning over.
  // The block lifts on its corners as it tumbles so it never sinks into the ground.
  const lift = UPRIGHT.includes(id) ? Math.abs(Math.sin(roll * 1.5)) * 2 : id === 'block' ? Math.abs(Math.sin(roll * 2)) * 3.3 : 0
  ctx.translate(x, y - lift)
  DRAW[id](ctx, roll)
  ctx.restore()
}
