/**
 * Formula engine for Records-as-AI-Sheets — a small, SAFE, deterministic expression evaluator.
 *
 * No eval(), no Function(), no prototype access: a hand-written tokenizer + recursive-descent
 * parser over an explicit grammar. Field references use {Field Name} and resolve against the
 * record's data object (case-insensitive, spaces ≙ underscores). Every failure is an HONEST
 * error result — a formula never fabricates a value and never throws into the render path.
 *
 * Grammar (precedence low→high):
 *   or     := and ("OR" and)*
 *   and    := cmp ("AND" cmp)*
 *   cmp    := add (("="|"!="|">"|"<"|">="|"<=") add)?
 *   add    := mul (("+"|"-"|"&") mul)*
 *   mul    := unary (("*"|"/"|"%") unary)*
 *   unary  := ("-"|"NOT") unary | primary
 *   primary:= number | string | field | func "(" args ")" | "(" or ")" | TRUE | FALSE
 *
 * Functions: IF(cond, then, else) · ROUND(x, digits?) · ABS(x) · MIN(...) · MAX(...) · SUM(...)
 *            DAYS(a, b) — whole days from date b to date a · TODAY() · CONCAT(...) · LEN(x)
 */

export type FormulaValue = number | string | boolean | null;
export type FormulaResult = { ok: true; value: FormulaValue } | { ok: false; error: string };

type Tok =
  | { t: "num"; v: number } | { t: "str"; v: string } | { t: "field"; v: string }
  | { t: "id"; v: string } | { t: "op"; v: string } | { t: "lp" } | { t: "rp" } | { t: "comma" };

function tokenize(src: string): Tok[] | { error: string } {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end < 0) return { error: "Unclosed field reference {…}" };
      toks.push({ t: "field", v: src.slice(i + 1, end).trim() });
      i = end + 1; continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) return { error: "Unclosed string" };
      toks.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1; continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      toks.push({ t: "num", v: Number(m[0]) });
      i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      toks.push({ t: "id", v: m[0].toUpperCase() });
      i += m[0].length; continue;
    }
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "!=") { toks.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/%=<>&".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    return { error: `Unexpected character "${c}"` };
  }
  return toks;
}

/** Case-insensitive, space/underscore-insensitive lookup into the record's data. */
function resolveField(data: Record<string, unknown>, name: string): FormulaValue {
  const want = name.toLowerCase().replace(/\s+/g, "_");
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase().replace(/\s+/g, "_") === want) {
      if (v == null) return null;
      if (typeof v === "number" || typeof v === "boolean") return v;
      if (typeof v === "string") {
        const n = Number(v);
        return v.trim() !== "" && Number.isFinite(n) ? n : v;
      }
      return String(v);
    }
  }
  return null;
}

const num = (v: FormulaValue): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`"${v}" is not a number`);
  return n;
};
const toDate = (v: FormulaValue): Date => {
  const d = new Date(String(v ?? ""));
  if (isNaN(d.getTime())) throw new Error(`"${v}" is not a date`);
  return d;
};

export function evaluateFormula(
  src: string,
  data: Record<string, unknown>,
  opts?: { now?: Date },
): FormulaResult {
  const toks = tokenize(src);
  if (!Array.isArray(toks)) return { ok: false, error: toks.error };
  if (toks.length === 0) return { ok: false, error: "Empty formula" };
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function args(): FormulaValue[] {
    const out: FormulaValue[] = [];
    if (peek()?.t === "rp") return out;
    out.push(or());
    while (peek()?.t === "comma") { next(); out.push(or()); }
    return out;
  }

  function call(name: string): FormulaValue {
    if (next()?.t !== "lp") throw new Error(`${name} needs (…)`);
    const a = args();
    if (next()?.t !== "rp") throw new Error(`${name}: missing )`);
    switch (name) {
      case "IF": if (a.length !== 3) throw new Error("IF needs 3 arguments"); return a[0] ? a[1]! : a[2]!;
      case "ROUND": { const d = a.length > 1 ? num(a[1]!) : 0; const f = 10 ** d; return Math.round(num(a[0]!) * f) / f; }
      case "ABS": return Math.abs(num(a[0]!));
      case "MIN": return Math.min(...a.map(num));
      case "MAX": return Math.max(...a.map(num));
      case "SUM": return a.reduce((acc: number, v) => acc + num(v), 0);
      case "DAYS": return Math.round((toDate(a[0]!).getTime() - toDate(a[1]!).getTime()) / 86_400_000);
      case "TODAY": return (opts?.now ?? new Date()).toISOString().slice(0, 10);
      case "CONCAT": return a.map(v => (v == null ? "" : String(v))).join("");
      case "LEN": return String(a[0] ?? "").length;
      default: throw new Error(`Unknown function ${name}`);
    }
  }

  function primary(): FormulaValue {
    const t = next();
    if (!t) throw new Error("Unexpected end of formula");
    if (t.t === "num") return t.v;
    if (t.t === "str") return t.v;
    if (t.t === "field") return resolveField(data, t.v);
    if (t.t === "id") {
      if (t.v === "TRUE") return true;
      if (t.v === "FALSE") return false;
      if (t.v === "NOT") return !primary();
      if (peek()?.t === "lp") return call(t.v);
      // bare identifier = field reference without braces
      return resolveField(data, t.v);
    }
    if (t.t === "lp") { const v = or(); if (next()?.t !== "rp") throw new Error("Missing )"); return v; }
    if (t.t === "op" && t.v === "-") return -num(primary());
    throw new Error("Unexpected token");
  }

  function unary(): FormulaValue {
    const t = peek();
    if (t?.t === "op" && t.v === "-") { next(); return -num(unary()); }
    return primary();
  }
  function mul(): FormulaValue {
    let v = unary();
    for (;;) {
      const t = peek();
      if (t?.t !== "op" || !["*", "/", "%"].includes(t.v)) return v;
      next();
      const r = num(unary());
      if (t.v === "/") { if (r === 0) throw new Error("Division by zero"); v = num(v) / r; }
      else if (t.v === "%") { if (r === 0) throw new Error("Division by zero"); v = num(v) % r; }
      else v = num(v) * r;
    }
  }
  function add(): FormulaValue {
    let v = mul();
    for (;;) {
      const t = peek();
      if (t?.t !== "op" || !["+", "-", "&"].includes(t.v)) return v;
      next();
      const r = mul();
      if (t.v === "&") v = `${v == null ? "" : v}${r == null ? "" : r}`;
      else if (t.v === "+") v = num(v) + num(r);
      else v = num(v) - num(r);
    }
  }
  function cmp(): FormulaValue {
    const l = add();
    const t = peek();
    if (t?.t !== "op" || !["=", "!=", ">", "<", ">=", "<="].includes(t.v)) return l;
    next();
    const r = add();
    if (t.v === "=") return l === r || num0(l) === num0(r);
    if (t.v === "!=") return !(l === r || num0(l) === num0(r));
    const a = num(l), b = num(r);
    return t.v === ">" ? a > b : t.v === "<" ? a < b : t.v === ">=" ? a >= b : a <= b;
  }
  // equality helper that tolerates "5" = 5 without throwing on strings
  const num0 = (v: FormulaValue): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && v !== "" && v != null && typeof v !== "boolean" ? n : null;
  };
  function and(): FormulaValue {
    let v = cmp();
    while (peek()?.t === "id" && (peek() as { v: string }).v === "AND") { next(); const r = cmp(); v = Boolean(v) && Boolean(r); }
    return v;
  }
  function or(): FormulaValue {
    let v = and();
    while (peek()?.t === "id" && (peek() as { v: string }).v === "OR") { next(); const r = and(); v = Boolean(v) || Boolean(r); }
    return v;
  }

  try {
    // AND/OR arrive as id tokens; cmp/add treat them via and()/or() — start at the top.
    const value = or();
    if (p !== toks.length) return { ok: false, error: "Unexpected trailing input" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Formula error" };
  }
}

/** The field names a formula references — for dependency display and cheap validation. */
export function formulaFields(src: string): string[] {
  const toks = tokenize(src);
  if (!Array.isArray(toks)) return [];
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.t === "field") out.add(t.v);
    if (t.t === "id" && !["IF","ROUND","ABS","MIN","MAX","SUM","DAYS","TODAY","CONCAT","LEN","AND","OR","NOT","TRUE","FALSE"].includes(t.v)
        && toks[i + 1]?.t !== "lp") out.add(t.v.toLowerCase());
  }
  return [...out];
}
