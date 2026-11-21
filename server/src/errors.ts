const brand = Symbol.for('visitor-verdict.Failure');
export class Failure extends Error {
  readonly [brand] = true;
  constructor(
    public reason: string,
    public indeterminate = false,
  ) {
    super(reason);
  }
}
export function failure(error: unknown): Failure {
  if (
    error &&
    typeof error === 'object' &&
    (error as Failure)[brand] === true &&
    typeof (error as Failure).reason === 'string' &&
    typeof (error as Failure).indeterminate === 'boolean'
  )
    return error as Failure;
  return new Failure('internal_error', true);
}
