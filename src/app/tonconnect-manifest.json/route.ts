import { AppConfig } from '@/config'

// The app manifest TON wallets fetch when the site connects over TON Connect
// (docs.ton.org/applications/ton-connect/core-concepts#manifest): open to any origin, `url` without a trailing
// slash, and a PNG icon (wallets do not render SVG).
export function GET() {
  const url = AppConfig.baseUrl.replace(/\/+$/, '')
  return Response.json(
    { url, name: AppConfig.appName, iconUrl: `${url}/tonconnect-icon.png` },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  )
}
