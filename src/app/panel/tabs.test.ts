import { describe, expect, it } from 'vitest'
import { speakerColors } from '../../ui/speaker'
import { tabBadge, type TabSignals } from './tabs'

const quiet: TabSignals = { live: true, count: 0, unread: 0, alerts: 0, air: { listening: false, speaking: false, speaker: null, colors: speakerColors(null) } }

describe('tabBadge', () => {
  it('says nothing when there is nothing to say', () => {
    for (const tab of ['now', 'transcripts', 'traffic', 'weather'] as const) expect(tabBadge(tab, false, quiet)).toBeNull()
  })

  it('counts new calls on Radio, but not while Radio is the tab being read', () => {
    const s = { ...quiet, unread: 3 }
    expect(tabBadge('transcripts', false, s)).toEqual({ kind: 'unread', text: '3', said: ', 3 new calls' })
    expect(tabBadge('transcripts', true, s)).toBeNull()
    expect(tabBadge('transcripts', false, { ...quiet, unread: 1 })?.said).toBe(', 1 new call')
    expect(tabBadge('transcripts', false, { ...quiet, unread: 40 })).toMatchObject({ text: '9+', said: ', 40 new calls' })
  })

  it('puts a dot on Now for alerts raised while it was out of view', () => {
    expect(tabBadge('now', false, { ...quiet, alerts: 2 })).toEqual({ kind: 'dot', said: ', 2 new alerts' })
    expect(tabBadge('now', true, { ...quiet, alerts: 2 })).toBeNull()
  })

  it('shows how many aircraft are in view on Traffic, live only', () => {
    expect(tabBadge('traffic', true, { ...quiet, count: 26 })).toEqual({ kind: 'count', text: '26', said: ', 26 aircraft' })
    expect(tabBadge('traffic', false, { ...quiet, live: false, count: 26 })).toBeNull()
  })

  it('leaves Weather plain: the station bar already shows the category', () => {
    expect(tabBadge('weather', false, { ...quiet, count: 26, unread: 3, alerts: 1 })).toBeNull()
  })
})
