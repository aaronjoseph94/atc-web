/**
 * System notifications for alerts while the app is in the background: via
 * the service worker when there is one (needed on Android and for installed
 * apps), else the page's own Notification. Only after the person turned it
 * on in Settings and the browser granted permission.
 */

export type NotifyPermission = NotificationPermission | 'unsupported'

export function notifyPermission(): NotifyPermission {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
}

/** Ask the browser (from a tap; browsers ignore requests that aren't). */
export async function requestNotify(): Promise<NotifyPermission> {
  if (notifyPermission() === 'unsupported') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return notifyPermission()
  }
}

/** Show one notification; `tag` replaces an earlier one about the same thing instead of stacking. */
export async function showNotification(title: string, body: string, tag: string, url: string): Promise<boolean> {
  if (notifyPermission() !== 'granted') return false
  const options: NotificationOptions = { body, tag, icon: '/pwa-192.png', badge: '/pwa-192.png', data: { url } }
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg) {
      await reg.showNotification(title, options)
      return true
    }
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      n.close()
    }
    return true
  } catch {
    return false
  }
}
