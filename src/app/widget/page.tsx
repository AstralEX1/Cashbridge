import type { Metadata } from 'next'
import { Widget } from './widget'
import { parseWidgetTheme, widgetThemeScript } from './theme'

export const metadata: Metadata = {
  title: 'Swap Widget | THORChain',
  robots: { index: false }
}

interface WidgetPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function WidgetPage({ searchParams }: WidgetPageProps) {
  const params = await searchParams
  const theme = parseWidgetTheme(params.theme)

  return (
    <>
      {theme && <script dangerouslySetInnerHTML={{ __html: widgetThemeScript(theme) }} />}
      <Widget theme={theme} />
    </>
  )
}
