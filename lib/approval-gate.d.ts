import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Config } from './config.js';
import type { ProjectMemoryStore } from './memory-store.js';
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
export declare const MEMORY_WRITE_TOOL = "project_memory_write";
/** Why an update proceeded without asking, named so tests and logs can tell the branches apart. */
export type MemoryUpdateAllowCause = 'approval-disabled' | 'no-approval-channel' | 'no-agent' | 'first-write' | 'child-session' | 'not-growing' | 'within-budget' | 'undecidable';
export type MemoryUpdateVerdict = {
    kind: 'allow';
    cause: MemoryUpdateAllowCause;
} | {
    kind: 'ask';
    reason: string;
};
/** The context facts the gate borrows, kept structural so tests need no cordis boot. */
export interface ApprovalChannelHost {
    get(name: string): unknown;
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
export declare function approvalChannelAsks(host: ApprovalChannelHost, agent: Agent): boolean;
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
export declare function isChildSession(agent: Agent): boolean;
/**
 * The IO-free skip reasons, evaluated before the stored profile is read.
 *
 * Order is meaningful: a disabled gate must not pay for a read, and an
 * agentless call cannot be routed anywhere.
 *
 * @returns the reason to skip gating, or `undefined` when the growth test decides.
 */
export declare function preflightSkip(config: Config, agent: Agent | undefined, channelAsks: boolean): MemoryUpdateAllowCause | undefined;
export interface MemoryUpdateAssessment {
    config: Config;
    agent: Agent | undefined;
    channelAsks: boolean;
    /** The stored body, or `undefined` when nothing is stored yet (no file, and no legacy predecessor). */
    storedContent: string | undefined;
    /** The complete body this call would write, exactly as the model submitted it. */
    nextContent: string;
    /** The call's own `reason` argument, shown to the human as the model's note. */
    note: string | undefined;
}
/** Whether this call would grow the profile past a budget. `undefined` stored content is the first write. */
export declare function assessGrowth(config: Config, storedContent: string | undefined, nextContent: string, note: string | undefined): MemoryUpdateVerdict;
/** The complete pure verdict, for callers that already hold the stored body. */
export declare function assessMemoryUpdate(input: MemoryUpdateAssessment): MemoryUpdateVerdict;
export interface ApprovalReasonFacts {
    currentBytes: number;
    nextBytes: number;
    growth: number;
    limitBytes: number;
    budgetBytes: number;
    watermarkPercent: number;
    overGrowthBudget: boolean;
    overWatermark: boolean;
    note: string | undefined;
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
export declare function approvalReason(facts: ApprovalReasonFacts): string;
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
export declare function registerMemoryApprovalGate(ctx: Context, store: ProjectMemoryStore, config: Config): void;
//# sourceMappingURL=approval-gate.d.ts.map