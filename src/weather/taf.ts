/**
 * A raw TAF split into its periods, one per line, the way pilots read it:
 * the base forecast, then each FM / BECMG / TEMPO / PROB group on its own line.
 */
export function tafLines(raw: string | null | undefined): string[] {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return []
  // PROB30 TEMPO stays together; a TEMPO right after a PROB group doesn't start a line of its own.
  return text
    .split(/ (?=(?:FM\d{6}|BECMG|PROB\d{2}|(?<!PROB\d{2} )TEMPO)\b)/)
    .map((s) => s.trim())
    .filter(Boolean)
}
