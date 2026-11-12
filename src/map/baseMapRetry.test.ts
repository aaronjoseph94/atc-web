import { describe, expect, it } from 'vitest'
import { retryDelay } from './baseMapRetry'

describe('base map retry', () => {
  it('backs off from 2 s, doubling, to at most 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000])
  })
})
