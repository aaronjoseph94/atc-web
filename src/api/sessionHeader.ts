/** The request header that carries the session token of the optional Turnstile gate (see ./session.ts). Shared by server and browser. */
export const SESSION_HEADER = 'x-atc-session'

/** Whether the gate is on, and the widget's public site key (from `GET /api/session` and `GET /api/ai`). */
export type GateInfo = { required: boolean; siteKey: string | null }
