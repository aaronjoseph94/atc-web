/**
 * A recorded scene: the clip's real manifest (cues and tracks) with its audio
 * swapped for a silent file of the same length, so the audio element really
 * plays and seeks without the test downloading the real recording.
 */
import { expect, test, type Page } from './support/test'

const SCENE = { id: 'jfk-tower-go-around', title: 'Kennedy Tower — arrivals and a go-around', durationS: 114 }

/** The replay's audio element (the live radio, when it exists, is a different one). */
const audio = (page: Page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('audio')].find((a) => a.src.includes('/clips/'))
    return el ? { src: el.src, paused: el.paused, t: el.currentTime, duration: el.duration } : null
  })

test('a recorded scene plays, seeks and goes back to live', async ({ app, page }) => {
  await app.open('JFK')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: /^Replay/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Replay' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: new RegExp(SCENE.title) }).click()
  await expect(sheet).toBeHidden()

  // Playback mode, at the scene's airport, with the audio element really playing.
  await expect.poll(() => app.playhead((s) => [s.mode, s.clip?.id, s.airportIcao])).toEqual(['playback', SCENE.id, 'JFK'])
  await expect.poll(async () => (await audio(page))?.src ?? '').toContain(`/clips/${SCENE.id}/audio.mp3`)
  await expect.poll(async () => (await audio(page))?.t ?? 0, { message: 'audio time advances' }).toBeGreaterThan(0.5)
  expect((await audio(page))?.paused).toBe(false)
  expect(Math.round((await audio(page))?.duration ?? 0)).toBeGreaterThanOrEqual(SCENE.durationS)
  // The station bar has become the timeline.
  const slider = page.getByRole('slider', { name: 'Replay position' })
  await expect(slider).toBeVisible()
  await expect(slider).toHaveAttribute('aria-valuemax', String(SCENE.durationS))
  // The first call is captioned, word by word.
  await expect(page.getByRole('button', { name: 'Open the transcript' })).toContainText('Delta four eighteen', { timeout: 30_000 })

  // Seek: tap the middle of the timeline; the clock and the audio both jump there.
  const box = (await slider.boundingBox())!
  if (app.isMobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(() => app.playhead((s) => Math.round(s.tMs / 1000))).toBeGreaterThanOrEqual(SCENE.durationS / 2 - 2)
  await expect.poll(async () => Math.round((await audio(page))?.t ?? 0)).toBeGreaterThanOrEqual(SCENE.durationS / 2 - 2)
  // Arrow keys step five seconds.
  const before = await app.playhead((s) => s.tMs)
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => app.playhead((s) => s.tMs)).toBeGreaterThanOrEqual(before + 4000)

  // Pause and play.
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(async () => (await audio(page))?.paused).toBe(true)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => (await audio(page))?.paused).toBe(false)

  // The transcript lists every call (a sheet on phones, the side panel on wide screens).
  // Beside the side panel, the transcript is its Radio tab; elsewhere it is in the menu.
  if (app.docked) await app.dockTab('Radio').click()
  else {
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: /^Transcript/ }).click()
  }
  const transcript = app.view('transcripts', 'Transcript')
  await expect(transcript).toBeVisible()
  if (app.docked) await expect(app.dockTab('Radio')).toHaveAttribute('aria-selected', 'true')
  const lines = transcript.getByRole('listitem')
  await expect.poll(() => lines.count()).toBeGreaterThan(6)
  // Search narrows it to the matching calls, highlighted.
  const search = transcript.getByRole('searchbox', { name: 'Search transcripts' })
  await search.fill('go around')
  await expect(transcript.getByText(/^\d+ match(es)?$/)).toBeVisible()
  await expect(lines.first()).toContainText('Speedbird one seven three heavy, go around')
  await expect(lines.first().locator('mark').first()).toHaveText(/^(go|around)/i)
  await search.fill('Speedbird')
  await expect(transcript.getByText(/^[6-9] matches/)).toBeVisible()
  // Tapping a call jumps the replay there.
  await lines.filter({ hasText: 'Speedbird one seven three heavy, Kennedy Tower' }).getByRole('button').click()
  if (!app.docked) await expect(transcript).toBeHidden()
  await expect.poll(() => app.playhead((s) => Math.round(s.tMs / 1000))).toBeLessThan(20)
  await expect.poll(() => app.playhead((s) => s.activeCallsign)).toBe('baw173')

  // Back to live.
  await page.getByRole('button', { name: 'Back to live', exact: true }).click()
  await expect.poll(() => app.playhead((s) => s.mode)).toBe('live')
  await expect.poll(async () => (await audio(page))?.paused ?? true).toBe(true)
  await expect(page.getByRole('button', { name: /^Change airport\./ })).toHaveText('JFK')
})
