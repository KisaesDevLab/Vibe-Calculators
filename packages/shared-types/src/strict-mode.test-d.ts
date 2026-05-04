/**
 * Type-level assertions that the strict tsconfig flags from
 * tsconfig.base.json are actually in effect for this workspace.
 *
 * These are not runtime tests — they exist purely to fail typecheck
 * if `strict`, `noUncheckedIndexedAccess`, or `exactOptionalPropertyTypes`
 * are silently relaxed in the future.
 */

// noUncheckedIndexedAccess: indexed access into an array yields T | undefined
const _arr: number[] = [1, 2, 3];
// @ts-expect-error — without noUncheckedIndexedAccess this would be `number`
const _n: number = _arr[0];
void _n;
// The non-error version is the explicit narrowing:
const _n2: number = _arr[0] ?? 0;
void _n2;

// strict / strictNullChecks: assigning null to a non-nullable type is an error
// @ts-expect-error — null is not assignable to string
const _s: string = null;
void _s;

// exactOptionalPropertyTypes: an optional property cannot be explicitly
// assigned `undefined` unless the type permits it.
type _Opt = { x?: string };
// @ts-expect-error — explicit undefined not assignable when exactOptionalPropertyTypes is true
const _o: _Opt = { x: undefined };
void _o;
