// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlayhead } from '../playback/playheadStore'
import { AirportPicker } from './AirportPicker'

describe('<AirportPicker />', () => {
  beforeEach(() => {
    usePlayhead.getState().setAirport('ORD')
    usePlayhead.getState().setPanel('airports')
  })
  afterEach(cleanup)

  it('renders nothing when closed', () => {
    usePlayhead.getState().setPanel(null)
    const { container } = render(<AirportPicker />)
    expect(container.innerHTML).toBe('')
  })

  it('lists both groups and marks the current airport', () => {
    render(<AirportPicker />)
    expect(screen.getByText('United States')).toBeTruthy()
    expect(screen.getByText('Canada')).toBeTruthy()
    const current = screen.getByText('ORD').closest('button')!
    expect(current.getAttribute('aria-pressed')).toBe('true')
  })

  it('selecting an airport switches and closes the sheet', () => {
    render(<AirportPicker />)
    fireEvent.click(screen.getByText('YVR'))
    expect(usePlayhead.getState().airportIcao).toBe('YVR')
    expect(usePlayhead.getState().panel).toBeNull()
  })

  it('Escape closes the sheet', () => {
    render(<AirportPicker />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(usePlayhead.getState().panel).toBeNull()
  })
})
