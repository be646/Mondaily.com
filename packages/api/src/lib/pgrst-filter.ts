/**
 * Values destined for a PostgREST `.or()` / `.filter()` STRING.
 *
 * Those take a filter expression, not bound parameters — `.or("a.eq.1,b.eq.2")` is parsed, so a
 * value containing a comma or a parenthesis stops being a value and becomes syntax. A caller-
 * supplied id spliced in raw can therefore add conditions to the expression it was meant to be an
 * operand of.
 *
 * It is NOT a tenant escape: the workspace filter is a separate `.eq()` that ANDs with the whole
 * expression, so an injected clause still cannot leave the workspace. What it can do is change
 * which of that workspace's rows come back, and hand an attacker a query-shaped error oracle.
 *
 * This exists as one function because the codebase had already solved it three separate ways —
 * `.replace(/[(),]/g, " ")` in search, `.replace(/[%,()]/g, " ")` in mcp, and nothing at all in
 * emails. A rule implemented per call site is not a rule; the fourth call site is where it breaks.
 */
export function orFilterValue(raw: unknown, maxLength = 200): string {
  return String(raw ?? "")
    // The PostgREST expression metacharacters: separator, grouping, and the LIKE wildcards that
    // would otherwise let a search term widen its own match.
    .replace(/[,()%*]/g, " ")
    .trim()
    .slice(0, maxLength);
}
