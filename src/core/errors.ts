export type ErrorCode = `LC_${string}`;
export class LcError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly scope: string | null = null,
    public readonly retryable = false, public readonly nextAction = 'lc_status') { super(message); this.name = 'LcError'; }
  toJSON() { return {code: this.code, message: this.message, scope: this.scope, retryable: this.retryable, nextAction: this.nextAction}; }
}
export function invariant(condition: unknown, code: ErrorCode, message: string, scope?: string): asserts condition {
  if (!condition) throw new LcError(code, message, scope);
}
