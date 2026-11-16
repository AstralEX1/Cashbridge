'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DOCS_SECTIONS } from '@/components/docs/docs-pages'

const SectionList = () => {
  const pathname = usePathname()
  return (
    <>
      {DOCS_SECTIONS.map(section => (
        <div key={section.title} className="docs-nav-section">
          <p>{section.title}</p>
          <ul>
            {section.pages.map(page => (
              <li key={page.href}>
                <Link href={page.href} aria-current={pathname === page.href ? 'page' : undefined}>
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

// Wide screens get a fixed sidebar; narrow ones fold the same list into a menu above the page.
export const DocsNav = () => (
  <>
    <nav className="docs-nav docs-nav-side" aria-label="Documentation">
      <SectionList />
    </nav>
    <details className="docs-nav docs-nav-fold">
      <summary>Menu</summary>
      <nav aria-label="Documentation">
        <SectionList />
      </nav>
    </details>
  </>
)
