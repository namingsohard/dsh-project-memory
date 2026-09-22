export class ProjectMemoryError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'ProjectMemoryError';
        this.code = code;
    }
}
export function isNodeError(error, code) {
    return error instanceof Error && 'code' in error && error.code === code;
}
//# sourceMappingURL=errors.js.map