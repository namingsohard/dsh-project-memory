import Schema from '@deepseek-ai/schemastery';
export const DEFAULT_CONFIG = {
    maxMemoryBytes: 48 * 1024,
    lockTimeoutMs: 5_000,
    staleLockMs: 30_000,
    requireApproval: true,
    approvalGrowthBytes: 1024,
    approvalWatermarkPercent: 80,
};
/**
 * The plugin configuration schema.
 *
 * Deliberately un-annotated. A `Schema<Config>` annotation compares two nominal
 * `Schema` declarations, and a DSH bundle can legitimately carry two copies of
 * `@deepseek-ai/schemastery` at once — the harness resolves its own range, the
 * plugin resolves its own, and `0.1.5-rc.1` / `0.1.5-rc.2` pair a `dsh-tools` and
 * `dsh-system-prompt` built against `3.18.4` with a `3.18.2` copy elsewhere in
 * the graph. The annotation then fails on `meta.default` under
 * `exactOptionalPropertyTypes`, and the same trap catches anything else that
 * names a schemastery type (`Schemastery.TypeT` included), even though the
 * runtime value is fine: cordis validates `Config` through the structural
 * `~standard` interface, and schemastery brands instances with the global
 * `Symbol.for('schemastery')`, so separate copies interoperate.
 *
 * `resolveConfig` below maps the schema's output onto `Config` and enumerates
 * every key of it, so a key added to the interface without being resolved there
 * is a compile error — that is what keeps this hand-maintained pair from
 * drifting.
 */
export const Config = Schema.object({
    maxMemoryBytes: Schema.number()
        .min(1_024)
        .max(1024 * 1024)
        .default(DEFAULT_CONFIG.maxMemoryBytes)
        .description('Maximum UTF-8 byte length of the Project Memory body.'),
    lockTimeoutMs: Schema.number()
        .min(100)
        .max(60_000)
        .default(DEFAULT_CONFIG.lockTimeoutMs)
        .description('Maximum time to wait for another Project Memory writer.'),
    staleLockMs: Schema.number()
        .min(1_000)
        .max(10 * 60_000)
        .default(DEFAULT_CONFIG.staleLockMs)
        .description('Age after which an abandoned Project Memory lock may be recovered.'),
    requireApproval: Schema.boolean()
        .default(DEFAULT_CONFIG.requireApproval)
        .description('Ask the user before a Project Memory update that would grow the stored profile past its budgets. Creating the profile in a workspace that has none is never gated.'),
    approvalGrowthBytes: Schema.number()
        .min(0)
        .max(1024 * 1024)
        .default(DEFAULT_CONFIG.approvalGrowthBytes)
        .description('Growth in UTF-8 bytes a Project Memory update may add before it asks for approval. A rewrite that does not grow the profile is never gated.'),
    approvalWatermarkPercent: Schema.number()
        .min(1)
        .max(100)
        .default(DEFAULT_CONFIG.approvalWatermarkPercent)
        .description('Percentage of maxMemoryBytes at which every Project Memory update asks for approval, however small its growth.'),
});
export function resolveConfig(config) {
    return {
        maxMemoryBytes: config?.maxMemoryBytes ?? DEFAULT_CONFIG.maxMemoryBytes,
        lockTimeoutMs: config?.lockTimeoutMs ?? DEFAULT_CONFIG.lockTimeoutMs,
        staleLockMs: config?.staleLockMs ?? DEFAULT_CONFIG.staleLockMs,
        requireApproval: config?.requireApproval ?? DEFAULT_CONFIG.requireApproval,
        approvalGrowthBytes: config?.approvalGrowthBytes ?? DEFAULT_CONFIG.approvalGrowthBytes,
        approvalWatermarkPercent: config?.approvalWatermarkPercent ?? DEFAULT_CONFIG.approvalWatermarkPercent,
    };
}
//# sourceMappingURL=config.js.map