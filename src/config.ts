import Schema from '@deepseek-ai/schemastery'

export interface Config {
  maxMemoryBytes: number
  lockTimeoutMs: number
  staleLockMs: number
  requireApproval: boolean
  approvalGrowthBytes: number
  approvalWatermarkPercent: number
}

export const DEFAULT_CONFIG: Config = {
  maxMemoryBytes: 48 * 1024,
  lockTimeoutMs: 5_000,
  staleLockMs: 30_000,
  requireApproval: true,
  approvalGrowthBytes: 1024,
  approvalWatermarkPercent: 80,
}

export const Config: Schema<Config> = Schema.object({
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
})

export function resolveConfig(config: Partial<Config> | undefined): Config {
  return {
    maxMemoryBytes: config?.maxMemoryBytes ?? DEFAULT_CONFIG.maxMemoryBytes,
    lockTimeoutMs: config?.lockTimeoutMs ?? DEFAULT_CONFIG.lockTimeoutMs,
    staleLockMs: config?.staleLockMs ?? DEFAULT_CONFIG.staleLockMs,
    requireApproval: config?.requireApproval ?? DEFAULT_CONFIG.requireApproval,
    approvalGrowthBytes: config?.approvalGrowthBytes ?? DEFAULT_CONFIG.approvalGrowthBytes,
    approvalWatermarkPercent: config?.approvalWatermarkPercent ?? DEFAULT_CONFIG.approvalWatermarkPercent,
  }
}
