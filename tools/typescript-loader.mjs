import { existsSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const src = fileURLToPath(new URL('../src/', import.meta.url))
export async function resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context)
  if (specifier.startsWith('@/')) {
    const candidate = src + specifier.slice(2) + '.ts'
    if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context)
  }
  return next(specifier, context)
}
export async function load(url, context, next) {
  if (!url.endsWith('.ts') || url.includes('/node_modules/')) return next(url, context)
  return {
    format: 'module',
    source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }),
    shortCircuit: true
  }
}
