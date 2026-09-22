export declare class ProjectMemoryError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
}
export declare function isNodeError(error: unknown, code: string): boolean;
//# sourceMappingURL=errors.d.ts.map