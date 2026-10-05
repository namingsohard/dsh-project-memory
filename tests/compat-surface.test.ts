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
  '0.2.0-rc.1',
  '0.2.0-rc.2',
  '0.2.1-alpha.1',
].join(' || ')

const PACKAGES = ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools']

/**
 * The cordis and schemastery versions the supported harness lines actually
 * resolve, read from the probe trees `.audit/compat-matrix.ps1` builds.
 */
const RESOLVED: Record<string, readonly string[]> = {
  '@deepseek-ai/cordis': ['4.0.2', '4.0.4', '4.0.5-alpha.1'],
  '@deepseek-ai/schemastery': ['3.18.2', '3.18.4', '3.18.5-alpha.1'],
}

/**
 * Satisfies, for the only range shapes this manifest uses: an exact version or a
 * caret range, joined by `||`. The one subtlety it keeps is the rule that costs
 * this plugin a release: a prerelease version satisfies a comparator only when
 * that comparator carries a prerelease of the same `[major, minor, patch]`.
 */
function satisfies(version: string, range: string): boolean {
  const parts = (input: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(input.trim())
    if (!match) throw new Error(`unsupported version or range in manifest: "${input}"`)
    return { major: +match[1]!, minor: +match[2]!, patch: +match[3]!, pre: match[4] }
  }
  const target = parts(version)
  return range.split('||').some((raw) => {
    const spec = raw.trim()
    if (!spec.startsWith('^')) return spec === version
    const base = parts(spec.slice(1))
    if (target.major !== base.major) return false
    const delta = target.minor - base.minor || target.patch - base.patch
    if (target.pre) return base.pre !== undefined && delta === 0
    return delta >= 0
  })
}

interface StandardSchema {
  '~standard': {
    validate: (value: unknown) => { issues?: readonly unknown[]; value?: unknown }
  }
}

function validate(value: unknown) {
  return (Config as unknown as StandardSchema)['~standard'].validate(value)
}

function range(packageName: string): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    peerDependencies: Record<string, string>
    dependencies: Record<string, string>
  }
  return manifest.peerDependencies[packageName] ?? manifest.dependencies[packageName] ?? ''
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
    expect(range(packageName)).toBe(SUPPORTED)
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      expect(readFileSync(new URL(`../${readme}`, import.meta.url), 'utf8'), readme).toContain(SUPPORTED)
    }
  })

  it.each(Object.entries(RESOLVED))('%s range admits every version a supported harness resolves', (packageName, versions) => {
    // The harness lines resolve different cordis and schemastery versions, and two
    // of them are prereleases: 0.2.1-alpha.1 runs cordis 4.0.5-alpha.1 and
    // schemastery 3.18.5-alpha.1, which a plain `^4.0.2` / `^3.18.2` rejects. On
    // schemastery, a real dependency, that rejection was measured to install a
    // second copy under the plugin beside the harness's; on the cordis peer pnpm
    // resolves the harness's copy anyway, but the declaration still has to be true.
    const spec = range(packageName)
    for (const version of versions) {
      expect(satisfies(version, spec), `${packageName}@${version} not admitted by "${spec}"`).toBe(true)
    }
  })

  it('rejects a prerelease whose own comparator carries none, which is what the ranges above avoid', () => {
    // The rule the supported lists exist to work around, asserted on the helper so
    // it cannot rot into something that always returns true.
    expect(satisfies('4.0.5-alpha.1', '^4.0.2')).toBe(false)
    expect(satisfies('4.0.5-alpha.1', '^4.0.5-alpha.1')).toBe(true)
    expect(satisfies('4.0.4', '^4.0.2 || ^4.0.5-alpha.1')).toBe(true)
    expect(satisfies('4.1.0', '^4.0.2')).toBe(true)
    expect(satisfies('5.0.0', '^4.0.2')).toBe(false)
  })
})
