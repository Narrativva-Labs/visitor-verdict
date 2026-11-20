export class Failure extends Error {
  constructor(
    public reason: string,
    public indeterminate = false,
  ) {
    super(reason);
  }
}
export function failure(error: unknown): Failure {
  return error instanceof Failure ? error : new Failure('internal_error', true);
}
