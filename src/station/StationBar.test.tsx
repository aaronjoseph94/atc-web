// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlayhead } from '../playback/playheadStore'
import { StationBar } from './StationBar'

describe('<StationBar />', () => {
  beforeEach(() => usePlayhead.getState().setAirport('ORD'))
  afterEach(cleanup)

  it('shows the airport code, name and first station', () => {
    render(<StationBar />)
    expect(screen.getByText('ORD')).toBeTruthy()
    expect(screen.getByText("Chicago O'Hare International")).toBeTruthy()
    expect(screen.getByText('Tower (Rwy 10L-28R)')).toBeTruthy()
  })

  it('opens the airport picker when the code is tapped', () => {
    render(<StationBar />)
    fireEvent.click(screen.getByLabelText('Change airport'))
    expect(usePlayhead.getState().panel).toBe('airports')
  })

  it('cycles stations when the station chip is tapped', () => {
    render(<StationBar />)
    fireEvent.click(screen.getByLabelText('Switch station'))
    expect(usePlayhead.getState().stationId).toBe('ord-ground-south')
    expect(screen.getByText('Ground (South Secondary)')).toBeTruthy()
  })
})
