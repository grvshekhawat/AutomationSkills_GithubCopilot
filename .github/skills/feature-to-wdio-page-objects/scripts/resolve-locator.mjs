#!/usr/bin/env node
/**
 * CLI / library entry for strict locator resolution from a DomNodeInfo JSON blob.
 *
 * Usage:
 *   node resolve-locator.mjs --node node.json --attr test-automation-id
 *   echo '{"tagName":"input",...}' | node resolve-locator.mjs --attr test-automation-id
 */

import fs from 'node:fs'
import {
  resolveLocator,
  attributeRootSelector,
  toCamelCase,
  buildRelativeCss,
} from './lib/resolve-locator.mjs'

function parseArgs(argv) {
  const out = { attr: 'test-automation-id', maxDepth: 8, allowAncestor: true }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--attr' || a === '--locator-attribute') out.attr = argv[++i]
    else if (a === '--node') out.nodePath = argv[++i]
    else if (a === '--max-depth') out.maxDepth = Number(argv[++i])
    else if (a === '--no-ancestor') out.allowAncestor = false
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

async function readNode(nodePath) {
  if (nodePath) {
    return JSON.parse(fs.readFileSync(nodePath, 'utf8'))
  }
  if (!process.stdin.isTTY) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text) return JSON.parse(text)
  }
  throw new Error('Provide --node <file.json> or pipe DomNodeInfo JSON on stdin')
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(`Usage: node resolve-locator.mjs --attr <name> [--node file.json]

Resolves a strict attribute locator (self or ancestor + relative child).`)
    process.exit(0)
  }

  const node = await readNode(args.nodePath)
  const result = resolveLocator(node, {
    locatorAttribute: args.attr,
    allowAncestorAttribute: args.allowAncestor,
    maxAncestorDepth: args.maxDepth,
  })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.gap ? 2 : 0)
}

export {
  resolveLocator,
  attributeRootSelector,
  toCamelCase,
  buildRelativeCss,
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('resolve-locator.mjs')) {
  main().catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })
}
