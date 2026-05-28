/**
 * Cleans the raw, streamed installer log so the UI shows readable progress
 * instead of a terminal dump. Tools like `ollama pull` assume a TTY and emit
 * cursor-control escapes plus carriage-return progress (thousands of
 * `pulling <layer>: 41%` rewrites), which otherwise flood the log with garbage.
 *
 * Two passes:
 *   1. `cleanLine` - strip ANSI/control escapes and resolve carriage returns so
 *      each streamed chunk renders as the single line a terminal would show.
 *   2. `appendCleanLog` - collapse consecutive progress updates that describe the
 *      same thing (a download layer, the manifest, a verify step) into one
 *      updating line, so a 7 GB model pull is a handful of lines, not thousands.
 */

// Built via new RegExp from plain-ASCII strings so no literal control bytes ever
// live in this source. Matches ANSI/VT escapes: CSI (colors, cursor moves,
// `[?25l`, `[1G`, `[K`, `[?2026h`), OSC (title), two-char escapes, stray ESC.
const ANSI_RE = new RegExp(
  "[\\u001B\\u009B]\\[[0-?]*[ -/]*[@-~]" + // CSI
    "|\\u001B\\][^\\u0007]*(?:\\u0007|\\u001B\\\\)" + // OSC ... BEL/ST
    "|\\u001B[@-Z\\\\-_]" + // two-char escapes
    "|[\\u001B\\u009B]", // stray introducer
  "g",
);
// Cursor-to-column moves (`[1G`, `[G`) - tools rewrite a progress line by homing
// the cursor instead of emitting a CR, so treat them as a CR (collapse the frame).
const CURSOR_COL_RE = new RegExp("\\u001B\\[\\d*G", "g");
// Braille-pattern block: the spinner glyphs (U+2800..U+28FF) most CLIs animate with.
const SPINNER_RE = new RegExp("[\\u2800-\\u28FF]", "g");
// Remaining C0 control chars (U+0000..U+001F, U+007F), keeping tab and newline.
const CTRL_RE = new RegExp("[\\u0000-\\u0008\\u000B-\\u001F\\u007F]", "g");

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Emulate a terminal's carriage return: text after the last `\r` overwrites the
 *  line. A trailing `\r` (cursor-home with nothing after) keeps the prior text. */
function resolveCarriageReturns(s: string): string {
  if (!s.includes("\r")) return s;
  const parts = s.split("\r");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== "") return parts[i];
  }
  return "";
}

/** Strip escapes + resolve carriage returns + drop spinner/control noise. Returns
 *  the readable single line (may be empty, meaning "nothing to show"). */
export function cleanLine(raw: string): string {
  const homed = raw.replace(CURSOR_COL_RE, "\r"); // cursor-home rewrites act like a CR
  const s = stripAnsi(homed);
  return resolveCarriageReturns(s)
    .replace(SPINNER_RE, "")
    .replace(CTRL_RE, "")
    .replace(/[ \t]+$/g, "");
}

// A progress line worth collapsing: an ollama pull phase, or anything carrying a
// percentage / transfer size / rate (download bars).
const PROGRESS_HEAD_RE = /^(pulling|verifying|writing|downloading|reading|using|removing|copying|success\b)/i;

/** A stable key for a progress line with its volatile parts (percent, sizes,
 *  rates, the bar) removed - so two updates of the same download layer share a
 *  key and collapse into one line. Null for non-progress lines (kept as-is). */
export function collapseKey(clean: string): string | null {
  const t = clean.trim();
  if (!t) return null;
  const isProgress = PROGRESS_HEAD_RE.test(t) || /\d{1,3}\s*%/.test(t) || /\d+(\.\d+)?\s*[KMGT]?B\b/i.test(t);
  if (!isProgress) return null;
  return t
    .replace(/\d+(\.\d+)?\s*[KMGT]?B(\/s)?/gi, "") // sizes + rates
    .replace(/\d{1,3}\s*%/g, "") // percentages
    .replace(/[^\x20-\x7E]+/g, " ") // bar glyphs / any non-ASCII
    .replace(/[\s:./]+$/g, "") // trailing counters / separators
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Append a raw streamed line to the log, cleaned and de-duplicated. Consecutive
 *  progress updates for the same subject replace the previous line instead of
 *  piling up; empty (control-only) lines are dropped. */
export function appendCleanLog(prev: string[], raw: string): string[] {
  const clean = cleanLine(raw);
  if (!clean.trim()) return prev;
  const key = collapseKey(clean);
  if (key && prev.length > 0 && collapseKey(prev[prev.length - 1]) === key) {
    const next = prev.slice(0, -1);
    next.push(clean);
    return next;
  }
  return [...prev, clean];
}
