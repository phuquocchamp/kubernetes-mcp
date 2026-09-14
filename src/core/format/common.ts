/**
 * Shared output primitives, ported from jenkins-mcp's agent-ergonomic
 * output contract.
 *
 * Phase 7 of the refactor plan (making tool output compact/counted/with
 * next: hints) is explicitly deferred to its own gated release — see
 * docs/REFACTOR-PATTERN.md. Formatters written in THIS pass keep emitting
 * the same JSON shape existing clients already parse. These helpers exist
 * now so a later phase-7 pass can adopt them one formatter at a time
 * without re-inventing them; do not reach for them to reshape payloads.
 */
const COLUMN_GAP = "  ";

export function table(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows.map((row) => row.map((cell) => (cell === "" ? "-" : cell)))];
  const widths = headers.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? "").length)),
  );

  return all
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join(COLUMN_GAP)
        .trimEnd(),
    )
    .join("\n");
}

export function listHeader(label: string, shown: number, total: number): string {
  return shown < total ? `${label} (showing ${shown} of ${total})` : `${label} (${total})`;
}

export function emptyState(thing: string, query?: string): string {
  return query ? `No ${thing} matched ${query}` : `No ${thing} found`;
}

export function withNext(body: string, hints: string[]): string {
  const lines = hints.filter((hint) => hint.length > 0).slice(0, 3);
  if (lines.length === 0) return body;
  return `${body}\n${lines.map((hint) => `next: ${hint}`).join("\n")}`;
}
