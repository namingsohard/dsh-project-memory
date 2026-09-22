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
export declare const Config: Schema<Config>;
export declare function resolveConfig(config: Partial<Config> | undefined): Config;
//# sourceMappingURL=config.d.ts.map