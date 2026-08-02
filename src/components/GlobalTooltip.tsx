import { useEffect, useState } from 'react'

type TooltipState = { text: string; x: number; y: number; placement: 'top' | 'bottom' }

const selector = 'button, [role="button"], [data-tooltip], input[type="range"]'

function tooltipText(element: HTMLElement) {
  const explicit = element.dataset.tooltip || element.getAttribute('aria-label') || element.getAttribute('title')
  const raw = explicit || (element.matches('button, [role="button"]') ? (element.innerText || element.textContent || '') : '')
  return raw.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    const migrateTitles = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>('[title]').forEach((element) => {
        if (!element.dataset.tooltip) element.dataset.tooltip = element.title
        element.removeAttribute('title')
      })
    }
    migrateTitles(document)
    const observer = new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        if (node.title) {
          node.dataset.tooltip ||= node.title
          node.removeAttribute('title')
        }
        migrateTitles(node)
      }
    })))
    observer.observe(document.body, { childList: true, subtree: true })

    const show = (event: Event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(selector)
      if (!target || target.dataset.tooltipDisabled === 'true') return
      const text = tooltipText(target)
      if (!text) return
      const rect = target.getBoundingClientRect()
      const placement = rect.top > 72 ? 'top' : 'bottom'
      setTooltip({
        text,
        x: Math.max(14, Math.min(window.innerWidth - 14, rect.left + rect.width / 2)),
        y: placement === 'top' ? rect.top - 10 : rect.bottom + 10,
        placement,
      })
    }
    const hide = (event?: Event) => {
      if (event instanceof PointerEvent) {
        const from = (event.target as HTMLElement | null)?.closest(selector)
        const to = (event.relatedTarget as HTMLElement | null)?.closest?.(selector)
        if (from && from === to) return
      }
      setTooltip(null)
    }
    document.addEventListener('pointerover', show)
    document.addEventListener('pointerout', hide)
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      observer.disconnect()
      document.removeEventListener('pointerover', show)
      document.removeEventListener('pointerout', hide)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  if (!tooltip) return null
  return <div className={`global-tooltip global-tooltip--${tooltip.placement}`} role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>
}
