/** What the map should say when it has no traffic to show. Pure, so it can be tested. */
import type { LiveStatus, PlayMode } from '../playback/playheadStore'

export type MapState = 'loading' | 'quiet' | 'offline' | null

export function mapStateFor({ mode, liveStatus, liveCount }: { mode: PlayMode; liveStatus: LiveStatus; liveCount: number }): MapState {
  // Replays bring their own traffic, and any aircraft on the map say more than a message would.
  if (mode !== 'live' || liveCount > 0) return null
  if (liveStatus === 'error') return 'offline'
  if (liveStatus === 'ok') return 'quiet'
  return 'loading'
}
