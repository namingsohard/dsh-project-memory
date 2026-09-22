import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import { normalizeMemoryContent } from './memory-format.js'
import type { ProjectMemoryStore } from './memory-store.js'

/**
 * Human approval for Project Memory growth.
 *
 * The problem this solves is not disk safety — `maxMemoryBytes` already caps
 * the file — but drift: an Agent that appends every session's findings turns a
 * current profile into a changelog nobody can trust. A rewrite that does not
 * grow the profile is therefore never gated, while a write that pushes past the
 * growth budget or the watermark of the size limit has to be approved by a
 * person. The first write of a workspace is exempt: creating the profile cannot
 * make it longer, and gating it would hide the mechanism exactly where the
 * plugin's own policy text asks for it.
 *
 * The gate is a `tools/pre-execute` listener, not something inside the tool
 * body. That is the harness's own approval seam: returning `{ kind: 'ask' }`
 * makes the TOOL REGISTRY resolve the decision through `ctx.approval`, so the
 * plugin needs no dependency on the approval service, the prompt is the
 * harness's own approval UI with this call attached, and every outcome is
 * audited as `approval/asked` + `approval/decided` on the session. It also
 * means the plugin inherits the harness's fail-closed mapping: a rejected,
 * cancelled, or unroutable ask denies the call before the body runs.
 *
 * @module project-memory/approval-gate
 */

/** The one tool this gate governs. */
export const MEMORY_WRITE_TOOL = 'project_memory_write'

/** Why an update proceeded without asking, named so tests and logs can tell the branches apart. */
export type MemoryUpdateAllowCause =
  | 'approval-disabled'
  | 'no-approval-channel'
  | 'no-agent'
  | 'first-write'
  | 'child-session'
  | 'not-growing'
  | 'within-budget'
  | 'undecidable'

export type MemoryUpdateVerdict =
  | { kind: 'allow'; cause: MemoryUpdateAllowCause }
  | { kind: 'ask'; reason: string }

/**
 * The approval service as this gate borrows it.
 *
 * Structural, and deliberately not a dependency: the plugin only asks whether
 * this deployment can and would prompt, and the registry performs the actual
 * request. A missing method reads as "assume it can ask", which keeps the
 * guardrail on for any implementation that does not expose the policy.
 */
interface ApprovalChannel {
  effectivePolicy?: (session: unknown) => unknown
}

/** The context facts the gate borrows, kept structural so tests need no cordis boot. */
export interface ApprovalChannelHost {
  get(name: string): unknown
}

/**
 * Whether this deployment would actually ask a human.
 *
 * Two skips live here. No approval service means the harness would turn the ask
 * into a denial (`serviceAsk` reports "not yet supported"), which would block
 * every memory update after the first on a deployment that never had a prompt
 * to show. An effective policy of `never` is the session saying "do not ask me"
 * — the registry would auto-reject the ask, so the gate stays out of the way
 * instead of turning an explicit preference into a hard failure.
 *
 * @param host - the plugin context, which exposes `ctx.get`.
 * @param agent - the agent owning the call.
 * @returns whether an ask would reach a human.
 */
export function approvalChannelAsks(host: ApprovalChannelHost, agent: Agent): boolean {
  const channel = host.get('approval') as ApprovalChannel | null | undefined
  if (channel === null || channel === undefined) return false
  try {
    if (typeof channel.effectivePolicy !== 'function') return true
    const policy = channel.effectivePolicy(agent.session)
    return policy === undefined || policy === 'ask'
  } catch {
    return true
  }
}

/**
 * Whether this session is a delegated child.
 *
 * Child sessions share their parent's workspace, and their approval requests
 * are not guaranteed to be routable to a UI; an unroutable ask is a denial, so
 * a child's memory write would fail rather than prompt. Children therefore stay
 * ungated and let the root session, which a human is actually watching, do the
 * gating.
 *
 * @param agent - the agent owning the call.
 * @returns whether the session was created as a subagent child.
 */
export function isChildSession(agent: Agent): boolean {
  const header = agent.session.header
  if (header.origin === 'subagent') return true
  return (header.delegationDepth ?? 0) > 0
}

/**
 * The IO-free skip reasons, evaluated before the stored profile is read.
 *
 * Order is meaningful: a disabled gate must not pay for a read, and an
 * agentless call cannot be routed anywhere.
 *
 * @returns the reason to skip gating, or `undefined` when the growth test decides.
 */
export function preflightSkip(
  config: Config,
  agent: Agent | undefined,
  channelAsks: boolean,
): MemoryUpdateAllowCause | undefined {
  if (!config.requireApproval) return 'approval-disabled'
  if (agent === undefined) return 'no-agent'
  if (!channelAsks) return 'no-approval-channel'
  if (isChildSession(agent)) return 'child-session'
  return undefined
}

export interface MemoryUpdateAssessment {
  config: Config
  agent: Agent | undefined
  channelAsks: boolean
  /** The stored body, or `undefined` when nothing is stored yet (no file, and no legacy predecessor). */
  storedContent: string | undefined
  /** The complete body this call would write, exactly as the model submitted it. */
  nextContent: string
  /** The call's own `reason` argument, shown to the human as the model's note. */
  note: string | undefined
}

/** Whether this call would grow the profile past a budget. `undefined` stored content is the first write. */
export function assessGrowth(
  config: Config,
  storedContent: string | undefined,
  nextContent: string,
  note: string | undefined,
): MemoryUpdateVerdict {
  if (storedContent === undefined) return { kind: 'allow', cause: 'first-write' }

  let next: string
  try {
    next = normalizeMemoryContent(nextContent)
  } catch {
    // The tool body owns content rejection (`INVALID_CONTENT`). A gate that
    // cannot measure the write must not turn a bad body into an approval
    // prompt the person cannot fix.
    return { kind: 'allow', cause: 'undecidable' }
  }

  const currentBytes = byteLength(storedContent)
  const nextBytes = byteLength(next)
  const growth = nextBytes - currentBytes
  if (growth <= 0) return { kind: 'allow', cause: 'not-growing' }

  const limitBytes = config.maxMemoryBytes
  const watermarkBytes = Math.floor(limitBytes * config.approvalWatermarkPercent / 100)
  const overGrowthBudget = growth > config.approvalGrowthBytes
  const overWatermark = nextBytes > watermarkBytes
  if (!overGrowthBudget && !overWatermark) return { kind: 'allow', cause: 'within-budget' }

  return {
    kind: 'ask',
    reason: approvalReason({
      currentBytes,
      nextBytes,
      growth,
      limitBytes,
      budgetBytes: config.approvalGrowthBytes,
      watermarkPercent: config.approvalWatermarkPercent,
      overGrowthBudget,
      overWatermark,
      note,
    }),
  }
}

/** The complete pure verdict, for callers that already hold the stored body. */
export function assessMemoryUpdate(input: MemoryUpdateAssessment): MemoryUpdateVerdict {
  const cause = preflightSkip(input.config, input.agent, input.channelAsks)
  if (cause !== undefined) return { kind: 'allow', cause }
  return assessGrowth(input.config, input.storedContent, input.nextContent, input.note)
}

export interface ApprovalReasonFacts {
  currentBytes: number
  nextBytes: number
  growth: number
  limitBytes: number
  budgetBytes: number
  watermarkPercent: number
  overGrowthBudget: boolean
  overWatermark: boolean
  note: string | undefined
}

/**
 * The sentence the person deciding actually reads.
 *
 * It is the only place the numbers reach a human: a non-grant outcome returns
 * the registry's own `the user rejected tool "…"` text to the model, so this
 * string exists purely to make the decision informed rather than reflexive.
 * What tripped the gate is named explicitly, because "over budget" and "nearly
 * full" call for different answers.
 *
 * @param facts - the measured sizes and the trigger combination.
 * @returns the prompt reason.
 */
export function approvalReason(facts: ApprovalReasonFacts): string {
  const trigger = facts.overGrowthBudget && facts.overWatermark
    ? `over the ${formatBytes(facts.budgetBytes)} silent-growth budget and past the ${facts.watermarkPercent}% watermark`
    : facts.overGrowthBudget
      ? `over the ${formatBytes(facts.budgetBytes)} silent-growth budget`
      : `past the ${facts.watermarkPercent}% watermark (${formatBytes(facts.nextBytes)} of ${formatBytes(facts.limitBytes)})`
  return `Rewrite this workspace's Project Memory: ${formatBytes(facts.currentBytes)} of ${formatBytes(facts.limitBytes)}, this update adds ${formatBytes(facts.growth)} (${trigger}).${quoteNote(facts.note)} Approve?`
}

/**
 * Quote the model's own note so a person reads it as a claim.
 *
 * The note is model-authored text rendered inside a decision prompt, so it is
 * collapsed to one line, stripped of quotes, and truncated: nothing in it may
 * impersonate the surrounding approval sentence or push the real numbers out of
 * sight.
 *
 * @param note - the call's raw `reason` argument, if any.
 * @returns one quoted sentence fragment, or an empty string.
 */
function quoteNote(note: string | undefined): string {
  if (note === undefined) return ''
  const collapsed = note
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length === 0) return ''
  const capped = collapsed.length > 160 ? `${collapsed.slice(0, 157)}...` : collapsed
  return ` Model's note: "${capped}".`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  return `${Number.isInteger(kib) ? kib.toFixed(0) : kib.toFixed(1)} KB`
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Register the approval gate.
 *
 * Only `project_memory_write` is inspected; every other call returns through
 * `next()` untouched. A gate that cannot decide — an unreadable profile, a
 * malformed argument, a harness whose agent shape changed — allows the call and
 * logs it, because the tool body re-validates everything and reports the
 * authoritative error. The only fail-closed part is the ask itself, and that
 * mapping belongs to the harness.
 *
 * @param ctx - the plugin context.
 * @param store - the store used to read the stored profile.
 * @param config - resolved plugin configuration.
 */
export function registerMemoryApprovalGate(
  ctx: Context,
  store: ProjectMemoryStore,
  config: Config,
): void {
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== MEMORY_WRITE_TOOL) return next()
    const decision = await verdictFor(ctx, store, config, exec)
    if (decision.kind === 'allow') return next()
    return { kind: 'ask', reason: decision.reason }
  })
}

async function verdictFor(
  ctx: Context,
  store: ProjectMemoryStore,
  config: Config,
  exec: ToolExecution,
): Promise<MemoryUpdateVerdict> {
  let cause: MemoryUpdateAllowCause | undefined
  try {
    const agent = exec.agent
    const channelAsks = agent === undefined ? false : approvalChannelAsks(ctx, agent)
    cause = preflightSkip(config, agent, channelAsks)
    if (cause !== undefined) return { kind: 'allow', cause }

    const cwd = agent?.session.header.cwd
    if (cwd === undefined) return { kind: 'allow', cause: 'undecidable' }

    const memory = await store.read(cwd, exec.signal)
    const args = updateArguments(exec)
    if (args.content === undefined) return { kind: 'allow', cause: 'undecidable' }
    return assessGrowth(
      config,
      memory.exists ? memory.content : undefined,
      args.content,
      args.reason,
    )
  } catch (error) {
    // The gate is an optional policy layer: a failure here must not replace the
    // tool's own result (or its own error) with a policy failure.
    ctx.logger?.warn(
      'project-memory: skipping approval gate for this update: %s',
      error instanceof Error ? error.message : String(error),
    )
    return { kind: 'allow', cause: cause ?? 'undecidable' }
  }
}

function updateArguments(exec: ToolExecution): { content: string | undefined; reason: string | undefined } {
  const raw = exec.arguments
  if (typeof raw !== 'object' || raw === null) return { content: undefined, reason: undefined }
  const { content, reason } = raw as { content?: unknown; reason?: unknown }
  return {
    content: typeof content === 'string' ? content : undefined,
    reason: typeof reason === 'string' ? reason : undefined,
  }
}
