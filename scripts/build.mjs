#!/usr/bin/env node
import { build } from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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

console.log('dist/ written')
