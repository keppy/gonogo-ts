// The few Python behaviours the output strings and numbers depend on. Each one
// differs from the obvious JavaScript spelling in a way a fixture would catch.

/** `format(x, f".{digits}f")`: round half to even on the exact binary value. */
export function fixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  const abs = Math.abs(x);
  if (abs >= 1e21) return sign + abs.toFixed(digits); // outside every value gonogo formats
  // toFixed(100) is the exact decimal expansion for every double gonogo formats,
  // so the tie test below sees the true digits, not a pre-rounded copy.
  const [whole, frac] = abs.toFixed(100).split(".");
  const kept = whole + frac.slice(0, digits);
  const rest = frac.slice(digits);
  const restIsZero = /^0*$/.test(rest);
  const tie = rest[0] === "5" && /^0*$/.test(rest.slice(1));
  const last = Number(kept[kept.length - 1]);
  const up = !restIsZero && (rest[0] > "5" || (rest[0] === "5" && !tie) || (tie && last % 2 === 1));
  const digitsOut = up ? increment(kept) : kept;
  const head = digitsOut.slice(0, digitsOut.length - digits) || "0";
  return sign + (digits > 0 ? `${head}.${digitsOut.slice(digitsOut.length - digits)}` : head);
}

function increment(s: string): string {
  const out = s.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === "9") out[i] = "0";
    else {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
  }
  return "1" + out.join("");
}

/** `format(x, f".{digits}%")`: Python multiplies by 100 in floating point first. */
export function percent(x: number, digits: number): string {
  return fixed(x * 100, digits) + "%";
}

/** gonogo's `stats.fmt_cut`: 2 to 4 places, the fewest that show `x` rounded to 4 (0.625, not 0.62). */
export function fmtCut(x: number): string {
  const target = Number(fixed(x, 4)); // Python's round(x, 4): the same correctly rounded decimal
  for (const places of [2, 3]) {
    const s = fixed(x, places);
    if (Number(s) === target) return s;
  }
  return fixed(x, 4);
}

/** gonogo's `stats.fmt_share`: a percent, whole when it is whole, else one place (62.5%). */
export function fmtShare(frac: number): string {
  const pct = Number(fixed(frac * 100, 1));
  return pct === Math.trunc(pct) ? percent(frac, 0) : percent(frac, 1);
}

/** Python's `repr(float)`: shortest round-trip digits, exponent outside 1e-4 .. 1e16. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const sign = x < 0 ? "-" : "";
  const [mant, exp] = Math.abs(x).toExponential().split("e");
  const digits = mant.replace(".", "");
  const decpt = Number(exp) + 1;
  if (decpt <= -4 || decpt > 16) {
    const e = decpt - 1;
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${m}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  if (decpt <= 0) return `${sign}0.${"0".repeat(-decpt)}${digits}`;
  if (decpt >= digits.length) return `${sign}${digits}${"0".repeat(decpt - digits.length)}.0`;
  return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
}

/**
 * Python's `repr()` of a parsed JSON value. A JSON number with no fraction is
 * taken to be an int, since `JSON.parse` cannot tell `1` from `1.0`.
 */
export function repr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 1e16 ? String(v) : floatRepr(v);
  if (typeof v === "string") return strRepr(v);
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  if (typeof v === "object") {
    return `{${Object.entries(v).map(([k, x]) => `${strRepr(k)}: ${repr(x)}`).join(", ")}}`;
  }
  return String(v);
}

/** Python's `str()` of a parsed JSON value. */
export function str(v: unknown): string {
  return typeof v === "string" ? v : repr(v);
}

function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (c === "\\" || c === quote) out += "\\" + c;
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (code < 0x20 || (code >= 0x7f && code <= 0xa0)) out += "\\x" + hex(code, 2);
    else if ((code >= 0xd800 && code <= 0xdfff) || code === 0x2028 || code === 0x2029) {
      const next = s.charCodeAt(i + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) out += c + s[++i]; // a paired astral char
      else out += "\\u" + hex(code, 4);
    } else out += c;
  }
  return quote + out + quote;
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

/** Python's `round(x)` to an int: half to even. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Python 3.12+ `sum()` of floats: Neumaier-compensated, as CPython does it. */
export function fsum(xs: number[]): number {
  let f = 0;
  let c = 0;
  for (const x of xs) {
    const t = f + x;
    c += Math.abs(f) >= Math.abs(x) ? (f - t) + x : (x - t) + f;
    f = t;
  }
  return c && Number.isFinite(c) ? f + c : f;
}

/** Python's `float()` of a parsed JSON value. */
export function toFloat(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/.test(t)) {
      return Number(t.replace(/_/g, ""));
    }
    const special = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
    if (special) {
      if (special[2].toLowerCase() === "nan") return NaN;
      return special[1] === "-" ? -Infinity : Infinity;
    }
    throw new RangeError(`could not convert string to float: ${strRepr(v)}`);
  }
  throw new TypeError(`float() argument must be a string or a real number, not '${pyTypeName(v)}'`);
}

function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  return Array.isArray(v) ? "list" : typeof v === "object" ? "dict" : typeof v;
}

/** Python's default string ordering: by code point, not by UTF-16 unit. */
export function cmpStr(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done && y.done ? 0 : x.done ? -1 : 1;
    const d = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (d !== 0) return d;
  }
}

/** Python truthiness of a parsed JSON value. */
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v !== null && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}
