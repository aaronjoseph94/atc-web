/**
 * Scroll edge fades for any element with the `scroll-fade` class: sets
 * `data-fade-top` / `data-fade-bottom` while there is more content above or
 * below, and index.css turns those into a soft mask at that edge.
 *
 * Installed once for the whole document, so a component opts in with a
 * class name alone: one capturing scroll listener, and a mutation observer
 * that finds new `.scroll-fade` elements and watches their size (content
 * arriving or the window resizing changes what is hidden too).
 */

/** Which edges have more content past them. Pure, for the tests. */
export function fadeEdges(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 2): { top: boolean; bottom: boolean } {
  return { top: scrollTop > slack, bottom: scrollTop + clientHeight < scrollHeight - slack }
}

function update(el: Element) {
  if (!(el instanceof HTMLElement)) return
  const { top, bottom } = fadeEdges(el.scrollTop, el.clientHeight, el.scrollHeight)
  // Only touch the DOM on a change: this runs on every scroll event.
  if (top !== el.hasAttribute('data-fade-top')) el.toggleAttribute('data-fade-top', top)
  if (bottom !== el.hasAttribute('data-fade-bottom')) el.toggleAttribute('data-fade-bottom', bottom)
}

let installed = false

export function installScrollFades() {
  if (installed || typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return
  installed = true
  const watched = new WeakSet<Element>()
  // Content changing size changes what's hidden, so observe the element and its children.
  const sizes = new ResizeObserver((entries) => {
    for (const e of entries) {
      const host = e.target.classList.contains('scroll-fade') ? e.target : e.target.parentElement
      if (host?.classList.contains('scroll-fade')) update(host)
    }
  })
  const watch = (el: Element) => {
    if (!watched.has(el)) {
      watched.add(el)
      sizes.observe(el)
    }
    for (const child of el.children) sizes.observe(child)
    update(el)
  }
  const scan = (root: ParentNode) => {
    if (root instanceof Element && root.classList.contains('scroll-fade')) watch(root)
    root.querySelectorAll?.('.scroll-fade').forEach(watch)
  }

  document.addEventListener('scroll', (e) => {
    const t = e.target
    if (t instanceof HTMLElement && t.classList.contains('scroll-fade')) update(t)
  }, { capture: true, passive: true })

  new MutationObserver((records) => {
    for (const r of records) {
      // New children of a watched list count too (rows arriving).
      if (r.target instanceof Element && r.target.classList.contains('scroll-fade')) watch(r.target)
      r.addedNodes.forEach((n) => {
        if (n instanceof Element) scan(n)
      })
      // Let go of what left the page, so the observer doesn't keep it alive.
      r.removedNodes.forEach((n) => {
        if (!(n instanceof Element)) return
        sizes.unobserve(n)
        n.querySelectorAll('.scroll-fade').forEach((el) => {
          sizes.unobserve(el)
          for (const child of el.children) sizes.unobserve(child)
        })
      })
    }
  }).observe(document.body, { childList: true, subtree: true })
  scan(document)
}
