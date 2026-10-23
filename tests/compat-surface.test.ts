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
 * schemastery type, and the declared dsh range must be the batch form the host
 * gate actually evaluates — `engines.dsh`, mirrored by the three dsh-* peer
 * ranges — admitting every version the compatibility matrix proves and every
 * prerelease the supported trains still ship.
 */

/**
 * The whole declared compatibility, as one batch range. `dsh-app-boot`'s
 * `evaluatePluginCompatibility` decides on `engines.dsh` alone when a manifest
 * carries it — ignoring peerDependencies — and evaluates it with
 * `semver.satisfies(..., { includePrerelease: true })`, so prereleases
 * participate like any other version and a floor+cap range means exactly the
 * interval it spells. The floor is the oldest line the compatibility matrix
 * proves; the cap keeps the promise inside the train that was verified, so
 * widening it is a deliberate once-per-train step rather than an assumption.
 */
const DSH_RANGE = '>=0.1.5-rc.1 <0.3'

/** The exact versions the compatibility matrix proves (.audit/compat-matrix.ps1). */
const PROVEN = [
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
  '0.2.1-alpha.2',
  '0.2.1-alpha.3',
  '0.2.1-alpha.4',
  '0.2.1-alpha.5',
  '0.2.1-rc.1',
  '0.2.1-rc.2',
]

const PACKAGES = ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools']

/**
 * The cordis and schemastery versions the supported harness lines run: what each
 * one pins at release, plus the stable pair a fresh install resolves to today.
 * Within `0.2.1` the pair moves three times — `alpha.1` / `alpha.2` name the
 * first prereleases, `alpha.3` and later the second ones, the `rc` line the
 * stable releases — and the plugin's two ranges have to admit all five, because
 * a bundle takes whichever of them the install happens to pick. These two are
 * resolved by the installer, not by the host gate, so they keep the prerelease
 * alternative a default-semantics semver needs.
 */
const RESOLVED: Record<string, readonly string[]> = {
  '@deepseek-ai/cordis': ['4.0.2', '4.0.4', '4.0.5-alpha.1', '4.0.5-alpha.2', '4.0.5'],
  '@deepseek-ai/schemastery': ['3.18.2', '3.18.4', '3.18.5-alpha.1', '3.18.5-alpha.2', '3.18.5'],
}

interface Parsed {
  major: number
  minor: number
  patch: number
  pre: string[]
}

function parseVersion(input: string): Parsed {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim())
  if (!match) throw new Error(`unsupported version in test: "${input}"`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Range comparators may name a partial version, and a partial version excludes
 * its own prereleases even under `includePrerelease`: real semver expands
 * `<0.3` to `<0.3.0-0`, so `0.3.0-rc.1` is outside the range while `<0.3.0`
 * would admit it. The declared range spells a partial cap, and the gate
 * reproduces this exact expansion, so the helper must too.
 */
function parseRangeVersion(input: string): Parsed {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim())
  if (!match) throw new Error(`unsupported range version in test: "${input}"`)
  const partial = match[2] === undefined || match[3] === undefined
  if (partial && match[4] !== undefined) throw new Error(`partial range version cannot carry a prerelease: "${input}"`)
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    pre: partial ? ['0'] : match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Prerelease identifiers compare numerically when both are numeric, lexically otherwise, numeric first. */
function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/.test(a)
  const numericB = /^\d+$/.test(b)
  if (numericA && numericB) return Number(a) < Number(b) ? -1 : Number(a) > Number(b) ? 1 : 0
  if (numericA) return -1
  if (numericB) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semver ordering, prereleases included: a prerelease sorts below its release. */
function compareVersions(a: Parsed, b: Parsed): number {
  for (const field of ['major', 'minor', 'patch'] as const) {
    if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1
  }
  if (a.pre.length === 0) return b.pre.length === 0 ? 0 : 1
  if (b.pre.length === 0) return -1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const order = compareIdentifiers(x, y)
    if (order !== 0) return order
  }
  return 0
}

interface Comparator {
  op: '>=' | '<'
  version: Parsed
}

function parseComparator(spec: string): Comparator {
  const match = /^(>=|<)\s*(.+)$/.exec(spec.trim())
  if (match) return { op: match[1] as Comparator['op'], version: parseRangeVersion(match[2]!) }
  return { op: '>=', version: parseRangeVersion(spec) }
}

/** The only range shapes this manifest uses: exact, `^`, and space-separated `>=`/`<` sets, joined by `||`. */
function parseMember(member: string): Comparator[] {
  const spec = member.trim()
  if (spec.startsWith('^')) {
    const base = parseVersion(spec.slice(1))
    const upper: Parsed =
      base.major > 0
        ? { major: base.major + 1, minor: 0, patch: 0, pre: [] }
        : base.minor > 0
          ? { major: 0, minor: base.minor + 1, patch: 0, pre: [] }
          : { major: 0, minor: 0, patch: base.patch + 1, pre: [] }
    return [{ op: '>=', version: base }, { op: '<', version: upper }]
  }
  if (/\s/.test(spec)) return spec.split(/\s+/).map(parseComparator)
  return [parseComparator(spec)]
}

/**
 * `satisfies` under the two semantics that matter here. With
 * `includePrerelease` it is what the host gate does — `dsh-app-boot` passes that
 * flag to `semver.satisfies`, which is why one batch range replaces a version
 * enumeration. Without it it is what installers do: a prerelease satisfies a
 * set only when a comparator of that set carries a prerelease of the same
 * `[major, minor, patch]`, the rule the cordis and schemastery ranges still
 * work around with a prerelease alternative.
 */
function satisfies(versionInput: string, range: string, options: { includePrerelease?: boolean } = {}): boolean {
  const version = parseVersion(versionInput)
  return range.split('||').some((member) => {
    const set = parseMember(member)
    const passes = set.every((comparator) => {
      const order = compareVersions(version, comparator.version)
      return comparator.op === '>=' ? order >= 0 : order < 0
    })
    if (!passes) return false
    if (version.pre.length > 0 && !options.includePrerelease) {
      return set.some(
        comparator =>
          comparator.version.pre.length > 0 &&
          comparator.version.major === version.major &&
          comparator.version.minor === version.minor &&
          comparator.version.patch === version.patch,
      )
    }
    return true
  })
}

function manifest(): {
  engines: Record<string, string>
  peerDependencies: Record<string, string>
  dependencies: Record<string, string>
} {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as ReturnType<typeof manifest>
}

interface StandardSchema {
  '~standard': {
    validate: (value: unknown) => { issues?: readonly unknown[]; value?: unknown }
  }
}

function validate(value: unknown) {
  return (Config as unknown as StandardSchema)['~standard'].validate(value)
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

  it('declares compatibility as one batch range, quoted identically in manifest and docs', () => {
    // engines.dsh is the field the host gate evaluates alone when present; the
    // three dsh-* peers mirror it so the declared requirement reads the same
    // wherever it is read. Both READMEs quote the same string.
    const parsed = manifest()
    expect(parsed.engines.dsh).toBe(DSH_RANGE)
    for (const packageName of PACKAGES) {
      expect(parsed.peerDependencies[packageName], packageName).toBe(DSH_RANGE)
    }
    for (const readme of ['README.md', 'README.zh-CN.md']) {
      expect(readFileSync(new URL(`../${readme}`, import.meta.url), 'utf8'), readme).toContain(DSH_RANGE)
    }
  })

  it('admits every proven version and every later prerelease of the supported trains', () => {
    // The gate evaluates with includePrerelease, which is the whole reason one
    // range replaces the old enumeration: the next 0.2.x prerelease is admitted
    // the day it is published, with no manifest edit. PROVEN stays the list the
    // compatibility matrix actually ran; an unproven version admitted by the
    // range is a declared bet, and raising the cap past <0.3 is the step that
    // needs a new matrix run, not a version list.
    for (const version of [...PROVEN, '0.2.1-rc.3', '0.2.2-alpha.1', '0.2.9-rc.1']) {
      expect(satisfies(version, DSH_RANGE, { includePrerelease: true }), version).toBe(true)
    }
  })

  it('holds the floor at 0.1.5-rc.1 and the cap below 0.3, prereleases included', () => {
    // The cap is written partial, `<0.3`, which real semver — and with it the
    // gate, which calls it unmodified — expands to `<0.3.0-0`: the first
    // prerelease of 0.3.0 is already outside. Pinned so the boundary is chosen
    // knowingly rather than discovered when a future train ships its first rc.
    for (const version of ['0.1.4-rc.1', '0.1.5-rc.0', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
      expect(satisfies(version, DSH_RANGE, { includePrerelease: true }), version).toBe(false)
    }
    expect(satisfies('0.3.0-rc.1', '>=0.1.5-rc.1 <0.3.0', { includePrerelease: true })).toBe(true)
    expect(satisfies('0.3.0', '>=0.1.5-rc.1 <0.3.0', { includePrerelease: true })).toBe(false)
  })

  it.each(Object.entries(RESOLVED))('%s range admits every version a supported harness resolves', (packageName, versions) => {
    // The harness lines resolve different cordis and schemastery versions, and
    // four of them are prereleases: the `0.2.1` line runs cordis
    // `4.0.5-alpha.1` (`alpha.1`-`alpha.2`), `4.0.5-alpha.2` (`alpha.3` onward)
    // and `4.0.5` (`rc.1` onward), with schemastery `3.18.5-alpha.1`,
    // `3.18.5-alpha.2` and `3.18.5` beside them, and a plain `^4.0.2` /
    // `^3.18.2` rejects the prereleases. These two ranges are read by the
    // installer, not the gate, so they keep the prerelease alternative. On
    // schemastery, a real dependency, that rejection was measured to install a
    // second copy under the plugin beside the harness's; on the cordis peer pnpm
    // resolves the harness's copy anyway, but the declaration still has to be true.
    const spec = manifest().peerDependencies[packageName] ?? manifest().dependencies[packageName] ?? ''
    for (const version of versions) {
      expect(satisfies(version, spec), `${packageName}@${version} not admitted by "${spec}"`).toBe(true)
    }
  })

  it('keeps the two prerelease semantics apart, which is what both range styles depend on', () => {
    // The gate's includePrerelease reading is what makes the batch range work
    // across prereleases; the installer's default reading is why the cordis and
    // schemastery ranges keep a prerelease alternative — and why pnpm may count
    // the mirrored dsh-* peers unmet when the harness itself is a prerelease,
    // silently: the gate is the only place compatibility is decided. Asserted on
    // the helper so neither reading can rot into something always true.
    expect(satisfies('0.2.1-rc.2', DSH_RANGE, { includePrerelease: true })).toBe(true)
    expect(satisfies('0.2.2-alpha.1', DSH_RANGE, { includePrerelease: true })).toBe(true)
    expect(satisfies('0.2.2-alpha.1', DSH_RANGE)).toBe(false)
    expect(satisfies('4.0.5-alpha.1', '^4.0.2')).toBe(false)
    expect(satisfies('4.0.5-alpha.1', '^4.0.5-alpha.1')).toBe(true)
    expect(satisfies('4.0.4', '^4.0.2 || ^4.0.5-alpha.1')).toBe(true)
    expect(satisfies('4.1.0', '^4.0.2')).toBe(true)
    expect(satisfies('5.0.0', '^4.0.2')).toBe(false)
  })
})
