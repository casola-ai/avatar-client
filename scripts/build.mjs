#!/usr/bin/env node
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

await Promise.all([
  build({
    entryPoints: [resolve(root, 'src/index.ts')],
    outfile: resolve(root, 'dist/index.js'),
    format: 'esm',
    bundle: true,
    platform: 'browser',
    target: ['es2020'],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(root, 'src/worklet/mic-worklet.ts')],
    outfile: resolve(root, 'dist/worklet/mic-worklet.js'),
    format: 'iife',
    bundle: true,
    platform: 'browser',
    target: ['es2020'],
    sourcemap: true,
  }),
])

// dist/styles.css is GENERATED from src/styles.ts — one source, two shipping shapes (a file for
// ordinary pages, the exported string for shadow roots). Never hand-edit the .css.
const { SESSION_UI_CSS } = await import(
  pathToFileURL(resolve(root, 'dist/index.js')).href
)
mkdirSync(resolve(root, 'dist'), { recursive: true })
writeFileSync(
  resolve(root, 'dist/styles.css'),
  `/* Generated from src/styles.ts by scripts/build.mjs — do not edit. */\n${SESSION_UI_CSS.trim()}\n`
)

console.log('dist/ written')
