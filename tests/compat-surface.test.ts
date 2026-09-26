import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_CONFIG } from '../src/config.js'

/**
 * Guards on the cross-version surface.
 *
 * These assert the properties that let one build serve every supported DeepSeek
 * Harness release, so an edit that quietly ties the plugin to one version fails
 * here rather than in a user's bundle: the config schema must stay usable through
 * the structural interface cordis actually calls, no source file may name a
 * schemastery type, and the documented version list must match the manifest.
 */

const SUPPORTED = [
  '0.1.5-rc.1',
  '0.1.5-rc.2',
  '0.1.5-rc.3',
  '0.1.6-alpha.1',
  '0.1.6-alpha.2',
  '0.1.7-alpha.1',
  '0.1.7-alpha.2',
  '0.1.7-rc.1',
  '0.1.7-rc.2',
].join(' || ')

const PACKAGES = ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools']

interface StandardSchema {
  '~standard': {
    validate: (value: unknown) => { issues?: readonly unknown[]; value?: unknown }
  }
}

function validate(value: unknown) {
  return (Config as unknown as StandardSchema)['~standard'].validate(value)
}

function peerRange(packageName: string): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    peerDependencies: Record<string, string>
  }
  return manifest.peerDependencies[packageName] ?? ''
}

describe('cross-version compatibility surface', () => {
  it('validates configuration through the structural ~standard interface cordis uses', () => {
    // cordis calls `Config['~standard'].validate(config)` instead of
    // instanceof-checking its own schemastery copy, which is what lets the plugin
    // and the harness resolve different schemastery versions. Defaults come back
    // filled in, and an out-of-range value is reported rather than thrown.
    expect(validate(DEFAULT_CONFIG).issues).toBeUndefined()
    expect(validate({}).value).toMatchObject(DEFAULT_CONFIG)
    expect(validate({ maxMemoryBytes: 1 }).issues).toEqual([
      expect.objectContaining({ message: expect.stringContaining('>= 1024') }),
    ])
  })

  it('names no schemastery type in src', () => {
    // A bundle can hold two copies of @deepseek-ai/schemastery at once — the
    // harness resolves its own range, the plugin resolves its own — and a
    // `Schema<Config>` annotation does not unify across copies. Only the runtime
    // value may cross that boundary.
    const sources = readdirSync(new URL('../src/', import.meta.url), { encoding: 'utf8' })
      .filter(name => name.endsWith('.ts'))
    expect(sources.length).toBeGreaterThan(0)

    for (const name of sources) {
      const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)[ \t]*\/\/.*/g, '$1')
      for (const line of code.split('\n')) {
        const statement = line.trim()
        if (!statement.startsWith('import') || !statement.includes('@deepseek-ai/schemastery')) continue
        expect(statement, `${name}: ${statement}`).toBe("import Schema from '@deepseek-ai/schemastery'")
      }
      expect(code, `${name}: names a schemastery type`).not.toMatch(/\bSchema</)
      expect(code, `${name}: names a schemastery namespace type`).not.toMatch(/\bSchemastery\./)
    }
  })

  it.each(PACKAGES)('%s peer range lists every supported version explicitly', (packageName) => {
    // Prereleases cannot be expressed as a caret range, so the list is explicit,
    // and both READMEs quote the same string.
    expect(peerRange(packageName)).toBe(SUPPORTED)
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      expect(readFileSync(new URL(`../${readme}`, import.meta.url), 'utf8'), readme).toContain(SUPPORTED)
    }
  })
})
