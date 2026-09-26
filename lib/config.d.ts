import Schema from '@deepseek-ai/schemastery';
export interface Config {
    maxMemoryBytes: number;
    lockTimeoutMs: number;
    staleLockMs: number;
    requireApproval: boolean;
    approvalGrowthBytes: number;
    approvalWatermarkPercent: number;
}
export declare const DEFAULT_CONFIG: Config;
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
export declare const Config: Schema<Schemastery.ObjectS<{
    maxMemoryBytes: Schema<number, number>;
    lockTimeoutMs: Schema<number, number>;
    staleLockMs: Schema<number, number>;
    requireApproval: Schema<boolean, boolean>;
    approvalGrowthBytes: Schema<number, number>;
    approvalWatermarkPercent: Schema<number, number>;
}>, Schemastery.ObjectT<{
    maxMemoryBytes: Schema<number, number>;
    lockTimeoutMs: Schema<number, number>;
    staleLockMs: Schema<number, number>;
    requireApproval: Schema<boolean, boolean>;
    approvalGrowthBytes: Schema<number, number>;
    approvalWatermarkPercent: Schema<number, number>;
}>>;
export declare function resolveConfig(config: Partial<Config> | undefined): Config;
//# sourceMappingURL=config.d.ts.map