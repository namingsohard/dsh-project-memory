import { ProjectMemoryError } from './errors.js';
export const MEMORY_FORMAT_VERSION = 1;
export function normalizeMemoryContent(content) {
    if (content.includes('\0')) {
        throw new ProjectMemoryError('INVALID_CONTENT', 'Project Memory must not contain NUL bytes.');
    }
    const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd();
    return normalized.length === 0 ? '' : `${normalized}\n`;
}
export function parseMemoryFile(raw) {
    const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!normalized.startsWith('---\n')) {
        return {
            revision: 0,
            content: normalizeMemoryContent(normalized),
            legacy: normalized.length > 0,
        };
    }
    const lines = normalized.split('\n');
    const closing = lines.indexOf('---', 1);
    if (closing < 0) {
        throw new ProjectMemoryError('INVALID_FORMAT', 'Project Memory frontmatter has no closing delimiter.');
    }
    const fields = new Map();
    for (const line of lines.slice(1, closing)) {
        if (line.trim().length === 0)
            continue;
        const match = /^([a-z][a-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
        if (match === null || match[1] === undefined || match[2] === undefined) {
            throw new ProjectMemoryError('INVALID_FORMAT', `Invalid Project Memory frontmatter line: ${line}`);
        }
        if (fields.has(match[1])) {
            throw new ProjectMemoryError('INVALID_FORMAT', `Duplicate Project Memory frontmatter key: ${match[1]}`);
        }
        fields.set(match[1], match[2]);
    }
    const unknown = [...fields.keys()].filter(key => key !== 'format' && key !== 'revision');
    if (unknown.length > 0) {
        throw new ProjectMemoryError('INVALID_FORMAT', `Unknown Project Memory frontmatter key: ${unknown[0]}`);
    }
    const format = Number(fields.get('format'));
    if (format !== MEMORY_FORMAT_VERSION) {
        throw new ProjectMemoryError('UNSUPPORTED_FORMAT', `Unsupported Project Memory format ${String(fields.get('format'))}; expected ${MEMORY_FORMAT_VERSION}.`);
    }
    const revisionText = fields.get('revision');
    if (revisionText === undefined || !/^(0|[1-9]\d*)$/.test(revisionText)) {
        throw new ProjectMemoryError('INVALID_FORMAT', 'Project Memory revision must be a non-negative integer.');
    }
    const revision = Number(revisionText);
    if (!Number.isSafeInteger(revision)) {
        throw new ProjectMemoryError('INVALID_FORMAT', 'Project Memory revision exceeds the safe integer range.');
    }
    const bodyLines = lines.slice(closing + 1);
    if (bodyLines[0] === '')
        bodyLines.shift();
    return {
        revision,
        content: normalizeMemoryContent(bodyLines.join('\n')),
        legacy: false,
    };
}
export function serializeMemoryFile(revision, content) {
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new ProjectMemoryError('INVALID_REVISION', 'Project Memory revision must be a non-negative safe integer.');
    }
    const body = normalizeMemoryContent(content);
    return `---\nformat: ${MEMORY_FORMAT_VERSION}\nrevision: ${revision}\n---\n${body.length === 0 ? '' : `\n${body}`}`;
}
//# sourceMappingURL=memory-format.js.map