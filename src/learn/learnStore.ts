/**
 * Which term explanation is showing (and where it was tapped), and whether
 * the glossary sheet is open. Transient UI state, not persisted.
 */
import { create } from 'zustand'

export type OpenTerm = {
  id: string
  /** The words as they appeared ("ILS 31R"), for the heading and the detail line. */
  text: string
  /** Where the tapped words are on screen, to place the popover beside them. */
  rect: { left: number; top: number; right: number; bottom: number } | null
}

type LearnState = {
  open: OpenTerm | null
  glossary: boolean
  /** Search to start the glossary with. */
  glossaryQuery: string
  show: (t: OpenTerm) => void
  close: () => void
  openGlossary: (query?: string) => void
  closeGlossary: () => void
}

export const useLearn = create<LearnState>((set) => ({
  open: null,
  glossary: false,
  glossaryQuery: '',
  show: (open) => set({ open }),
  close: () => set({ open: null }),
  openGlossary: (query = '') => set({ glossary: true, glossaryQuery: query, open: null }),
  closeGlossary: () => set({ glossary: false }),
}))
