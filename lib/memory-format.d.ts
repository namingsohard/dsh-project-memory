export declare const MEMORY_FORMAT_VERSION = 1;
export interface ParsedMemory {
    revision: number;
    content: string;
    legacy: boolean;
}
export declare function normalizeMemoryContent(content: string): string;
export declare function parseMemoryFile(raw: string): ParsedMemory;
export declare function serializeMemoryFile(revision: number, content: string): string;
//# sourceMappingURL=memory-format.d.ts.map