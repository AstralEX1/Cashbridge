import { AppConfig } from '@/config'

// Tonkeeper checks the manifest against the page's exact origin, including www and preview domains.
export function GET(request: Request) {
  const url = new URL(request.url).origin
  return Response.json(
    { url, name: AppConfig.appName, iconUrl: `${url}/tonconnect-icon.png` },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  )
}
