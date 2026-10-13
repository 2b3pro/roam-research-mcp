/**
 * Datalog query text helpers.
 */

/**
 * Render a value as a Datalog (EDN) string literal, quotes included.
 *
 * Every value placed inside a query string goes through this. Interpolating
 * it raw lets a `"` close the literal early: `Alex "Sandy" Pentland` becomes
 * `"Alex "Sandy" Pentland"`, which Roam rejects with IndexOutOfBoundsException,
 * and a `\` is read as the start of an escape. Prefer binding the value with
 * `:in` where the query shape allows; this is for the places it does not,
 * such as an `or` over several case variations.
 */
export function ednString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
