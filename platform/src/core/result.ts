/**
 * Result algebra shared by every platform boundary.
 *
 * ReaOS services never throw across a boundary: expected failures are returned
 * as a tagged `Result` value so callers must decide what to do with them. This
 * mirrors the error model used by the surrounding REA codebase and keeps
 * failures inspectable in logs, tests and the HTTP API.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  !result.ok;

export const mapResult = <T, U, E>(
  result: Result<T, E>,
  transform: (value: T) => U,
): Result<U, E> => (result.ok ? ok(transform(result.value)) : result);

export const mapErr = <T, E, F>(
  result: Result<T, E>,
  transform: (error: E) => F,
): Result<T, F> => (result.ok ? result : err(transform(result.error)));

export const andThen = <T, U, E>(
  result: Result<T, E>,
  next: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? next(result.value) : result);

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/**
 * Runs an async task and converts a thrown value into a `Result` failure.
 * Used at the edges where a third-party module (filesystem, child process)
 * can still throw.
 */
export const fromPromise = async <T, E>(
  task: Promise<T>,
  onReject: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await task);
  } catch (cause) {
    return err(onReject(cause));
  }
};
