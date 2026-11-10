// Types for scripts/ai-cleanup.mjs, so its tests typecheck.

export type TypeFactsRow = {
  name: string
  manufacturer: string
  kind: string
  engines: { count: number; type: string }
  spanM?: number | null
  lengthM?: number | null
  seats?: string | null
  rangeNm?: number | null
  cruise?: { mach: number } | { kt: number }
  firstFlight?: number | null
}

export type Tables = {
  airlines: Record<string, [string, string]>
  fliesFor: Record<string, string>
  telephony: Record<string, string[]>
  types: Record<string, TypeFactsRow>
}

export type Seen = { types: Map<string, number>; prefixes: Map<string, { count: number; example: string | null }> }
export type Unknown = { types: [string, number][]; prefixes: [string, { count: number; example: string | null }][] }
export type Finding = { kind: string; key: string; message: string }
export type Request = { id: string; kind: string; count: number; keys: string[]; system: string; prompt: string; schema: Record<string, unknown> }
export type Op = { id: string; kind: string; key: string; file: string; table: string; action: 'set' | 'add'; value: unknown; field?: string; before?: unknown; reason: string; confidence: string }
export type Manual = { kind: string; key: string; note: string; reason: string; confidence: string; detail: unknown }
export type Answers = Record<string, { json?: { issues: Record<string, unknown>[] } | null; error?: string }>

export const REPO_ROOT: string
export const FILES: Record<'airlines' | 'telephony' | 'types' | 'ai', string>
export const SYSTEM: string
export const SCHEMAS: Record<string, Record<string, unknown>>
export const KINDS: string[]

export function parseArgs(argv: string[]): Record<string, unknown>
export function tableSpan(lines: string[], marker: string): { start: number; end: number }
export function loadTables(root: string): Promise<Tables>
export function loadModelDefaults(root: string): Promise<{ defaultModel: string | null; openrouter: Record<string, string> }>
export function mergeSeen(docs: unknown[]): Seen
export function unknownSeen(seen: Seen, tables: Tables): Unknown
export function localChecks(tables: Tables, unknown: Unknown, year?: number): Finding[]
export function reviewItems(tables: Tables, unknown: Unknown): Record<string, unknown[]>
export function buildRequests(tables: Tables, unknown: Unknown, opts?: { only?: string[] | null; chunk?: number }): Request[]
export function pickProvider(opts: { provider?: string | null }, env?: Record<string, string | undefined>): 'anthropic' | 'openrouter' | null
export function serializeRow(table: string, key: string, value: unknown): string
export function parseFieldValue(field: string, text: string): unknown
export function toOps(answers: Answers, reqs: Request[], tables: Tables): { ops: Op[]; manual: Manual[] }
export function opLine(op: Op, tables: Tables): string
export function applyPatch(root: string, patch: { ops?: Op[] }, ids?: string[] | null): Promise<{ applied: string[]; skipped: { id: string; why: string }[] }>
export function renderReport(args: { date: string; model: string; provider: string; mode: string; reqs: Request[]; local: Finding[]; ops: Op[]; manual: Manual[]; failures: { id: string; error: string }[]; tables: Tables; patchFile: string }): string
export function main(argv: string[], deps?: { log?: (s: string) => void; env?: Record<string, string | undefined>; fetchFn?: typeof fetch }): Promise<number>
