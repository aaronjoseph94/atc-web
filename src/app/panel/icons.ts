/**
 * One icon treatment for the side panel, its rail and its menu: lucide, 16 px,
 * a 2 px stroke, in the text colour of whatever holds it (quiet white until
 * hovered or chosen). Icon buttons are 32 px circles with the same hover.
 */
export const PANEL_ICON = { className: 'size-4 shrink-0', strokeWidth: 2 } as const

export const PANEL_ICON_BUTTON =
  'has-tooltip pressable relative grid size-8 shrink-0 place-items-center rounded-full text-white/60 transition-colors duration-[var(--duration-fast)] hover:bg-white/10 hover:text-white'
