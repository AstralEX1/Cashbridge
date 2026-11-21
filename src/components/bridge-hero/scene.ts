import { WORLD } from '@/components/bridge-hero/game'

// Worlds in the colours of the chains a transfer comes from, one season each. A run starts in the
// source chain's world and moves on to the next one every few blocks.
type Weather = 'fireflies' | 'stars' | 'snow' | 'leaves' | 'petals'
export type Theme = {
  sky: [string, string]
  orb: { x: number; y: number; r: number; color: string }
  far: [string, string]
  near: string
  ridge: number // shapes the mountains so each world has its own skyline
  clouds: number // share of the sky with a cloud
  cloud: string
  weather: Weather
  block: string
  edge: string
  aurora?: [string, string]
}

export const THEMES: Theme[] = [
  // Bitcoin Cash, summer
  {
    sky: ['#06221b', '#145a45'],
    orb: { x: 300, y: 42, r: 16, color: '#fff1b8' },
    far: ['#2b7a5f', '#123d30'],
    near: '#0c2c22',
    ridge: 1,
    clouds: 0.7,
    cloud: '#e9fff4',
    weather: 'fireflies',
    block: '#0a2219',
    edge: '#31fd9d'
  },
  // Solana, a night with aurora
  {
    sky: ['#07031a', '#2a0f5c'],
    orb: { x: 64, y: 38, r: 11, color: '#efeaff' },
    far: ['#3b2380', '#170c38'],
    near: '#110a2a',
    ridge: 2,
    clouds: 0.25,
    cloud: '#b9a6ff',
    weather: 'stars',
    block: '#140b33',
    edge: '#14f195',
    aurora: ['#14f195', '#9945ff']
  },
  // NEAR, winter
  {
    sky: ['#0a1620', '#3c5b6e'],
    orb: { x: 290, y: 46, r: 13, color: '#f2fbff' },
    far: ['#f4fbff', '#4d6878'],
    near: '#1b2c36',
    ridge: 3,
    clouds: 0.6,
    cloud: '#ffffff',
    weather: 'snow',
    block: '#13212a',
    edge: '#00ec97'
  },
  // Ethereum, autumn dusk
  {
    sky: ['#17122f', '#8a4f5e'],
    orb: { x: 250, y: 88, r: 18, color: '#ffb36b' },
    far: ['#5a467f', '#2a2148'],
    near: '#1f1934',
    ridge: 4,
    clouds: 0.45,
    cloud: '#ffd9c2',
    weather: 'leaves',
    block: '#1b1630',
    edge: '#8fa2ff'
  },
  // THORChain, spring
  {
    sky: ['#041d26', '#16707a'],
    orb: { x: 80, y: 50, r: 14, color: '#fff6d6' },
    far: ['#2a8f8c', '#0f4547'],
    near: '#0b2f33',
    ridge: 5,
    clouds: 0.8,
    cloud: '#eafffb',
    weather: 'petals',
    block: '#0a252a',
    edge: '#33ff99'
  }
]
export const BLOCKS_PER_WORLD = 8

// Chain ids from @tcswap/core; anything unlisted starts in the Bitcoin Cash world.
const START: Record<string, number> = { BCH: 0, SOL: 1, NEAR: 2, ETH: 3, ARB: 3, BASE: 3, AVAX: 3, BSC: 3, POL: 3, OP: 3, THOR: 4, GAIA: 4, MAYA: 4 }
export const startWorld = (chain?: string) => START[chain ?? ''] ?? 0
export const worldAt = (start: number, score: number) => (start + Math.floor(score / BLOCKS_PER_WORLD)) % THEMES.length

// Cheap repeatable noise for cloud and particle placement.
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const ridge = (ctx: CanvasRenderingContext2D, theme: Theme, shift: number, base: number, height: number, layer: number, fill: string | CanvasGradient) => {
  const k = theme.ridge * 1.7 + layer * 3.1
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(0, WORLD.height)
  for (let x = 0; x <= WORLD.width; x += 6) {
    const u = x + shift
    const y = base - height * (0.55 * Math.sin(u * 0.011 + k) + 0.3 * Math.sin(u * 0.027 + k * 2.3) + 0.15 * Math.sin(u * 0.061 + k * 4.1) + 0.5)
    ctx.lineTo(x, y)
  }
  ctx.lineTo(WORLD.width, WORLD.height)
  ctx.fill()
}

const cloud = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  ctx.beginPath()
  ctx.arc(x, y, 9 * size, 0, Math.PI * 2)
  ctx.arc(x + 11 * size, y - 5 * size, 11 * size, 0, Math.PI * 2)
  ctx.arc(x + 24 * size, y, 9 * size, 0, Math.PI * 2)
  ctx.rect(x, y, 24 * size, 9 * size)
  ctx.fill()
}

const weather = (ctx: CanvasRenderingContext2D, theme: Theme, camera: number, time: number) => {
  const { width: W, height: H } = WORLD
  for (let i = 0; i < 26; i++) {
    const a = hash(i + theme.ridge * 50)
    const b = hash(i * 7.3 + theme.ridge)
    switch (theme.weather) {
      case 'stars': {
        if (b > 0.5) continue
        ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(time * (0.6 + a) + i))
        ctx.fillStyle = '#ffffff'
        ctx.fillRect((((a * W * 1.7 - camera * 0.05) % W) + W) % W, b * 110, 1.2, 1.2)
        break
      }
      case 'snow': {
        const x = (((a * W - camera * 0.4 + Math.sin(time + i) * 8) % W) + W) % W
        const y = (b * H + time * (14 + a * 16)) % H
        ctx.globalAlpha = 0.85
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(x, y, 0.8 + a, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      case 'leaves':
      case 'petals': {
        if (b > 0.6) continue
        const x = (((a * W * 1.4 - camera * 0.4 - time * 14) % W) + W) % W
        const y = (b * H + time * (16 + a * 10)) % H
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(time * (1 + a) + i)
        ctx.globalAlpha = 0.9
        ctx.fillStyle = theme.weather === 'leaves' ? (a > 0.5 ? '#e8893a' : '#c9512e') : a > 0.5 ? '#ffc2dc' : '#ffe3ee'
        ctx.beginPath()
        ctx.ellipse(0, 0, 2.4, 1.2, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        break
      }
      case 'fireflies': {
        if (b > 0.45) continue
        const x = (((a * W * 1.3 - camera * 0.5 + Math.sin(time * 0.7 + i) * 10) % W) + W) % W
        const y = WORLD.top - 70 + b * 120 + Math.cos(time * 0.9 + i * 2) * 6
        ctx.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(time * 1.3 + i))
        ctx.fillStyle = '#d8ff8a'
        ctx.beginPath()
        ctx.arc(x, y, 1.1, 0, Math.PI * 2)
        ctx.fill()
        break
      }
    }
  }
  ctx.globalAlpha = 1
}

// Everything behind the blocks, in world units. `camera` drives the parallax, `time` the weather.
export const drawScene = (ctx: CanvasRenderingContext2D, theme: Theme, camera: number, time: number) => {
  const { width: W, height: H } = WORLD
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, theme.sky[0])
  sky.addColorStop(1, theme.sky[1])
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  const { orb } = theme
  const halo = ctx.createRadialGradient(orb.x, orb.y, orb.r * 0.6, orb.x, orb.y, orb.r * 3.2)
  halo.addColorStop(0, `${orb.color}55`)
  halo.addColorStop(1, `${orb.color}00`)
  ctx.fillStyle = halo
  ctx.fillRect(orb.x - orb.r * 4, orb.y - orb.r * 4, orb.r * 8, orb.r * 8)
  ctx.fillStyle = orb.color
  ctx.beginPath()
  ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2)
  ctx.fill()

  if (theme.aurora) {
    ctx.lineWidth = 12
    theme.aurora.forEach((color, band) => {
      ctx.strokeStyle = `${color}2e`
      ctx.beginPath()
      for (let x = 0; x <= W; x += 8) {
        const y = 34 + band * 16 + Math.sin(x * 0.018 + time * 0.4 + band * 2) * 9
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    })
  }

  // Clouds drift on their own and pass by slower than the ground; some stretches of sky stay clear.
  ctx.fillStyle = `${theme.cloud}3d`
  const drift = camera * 0.2 + time * 5
  for (let i = Math.floor(drift / 130) - 1; i <= Math.floor((drift + W) / 130) + 1; i++) {
    if (hash(i + theme.ridge * 13) > theme.clouds) continue
    cloud(ctx, i * 130 - drift + hash(i * 3.1) * 50, 30 + hash(i * 5.7) * 50, 0.7 + hash(i * 9.3) * 0.6)
  }

  const far = ctx.createLinearGradient(0, 60, 0, WORLD.top + 10)
  far.addColorStop(0, theme.far[0])
  far.addColorStop(1, theme.far[1])
  ridge(ctx, theme, camera * 0.15, WORLD.top - 6, 74, 0, far)
  ridge(ctx, theme, camera * 0.35, WORLD.top + 18, 40, 1, theme.near)
  weather(ctx, theme, camera, time)
}
