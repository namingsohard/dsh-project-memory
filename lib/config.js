import Schema from '@deepseek-ai/schemastery';
export const DEFAULT_CONFIG = {
    maxMemoryBytes: 48 * 1024,
    lockTimeoutMs: 5_000,
    staleLockMs: 30_000,
};
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
});
export function resolveConfig(config) {
    return {
        maxMemoryBytes: config?.maxMemoryBytes ?? DEFAULT_CONFIG.maxMemoryBytes,
        lockTimeoutMs: config?.lockTimeoutMs ?? DEFAULT_CONFIG.lockTimeoutMs,
        staleLockMs: config?.staleLockMs ?? DEFAULT_CONFIG.staleLockMs,
    };
}
//# sourceMappingURL=config.js.map