// Resolves the app's `@/` path alias (tsconfig "paths") for the bridge unit tests and compiles
// the TypeScript sources with the project's own `typescript`, which (unlike Node's type
// stripping) drops imports that are only used as types.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = SRC + specifier.slice(2)
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context)
    }
  }
  // `next` ships no exports map, so its subpath entry points need their file extension under ESM.
  if (specifier === 'next/server') return next('next/server.js', context)
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (!/\.tsx?$/.test(url) || url.includes('/node_modules/')) return next(url, context)
  const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  })
  return { format: 'module', source: outputText, shortCircuit: true }
}
