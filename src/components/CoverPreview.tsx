import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function CoverPreview({ title, url, fallbackUrl, onClose }: { title: string; url: string; fallbackUrl: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState(url)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return createPortal(<dialog ref={dialogRef} className="cover-preview" aria-label={`Обложка: ${title}`} onCancel={(event) => { event.preventDefault(); onClose() }} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => {
    event.stopPropagation()
    if (event.target === event.currentTarget) onClose()
  }}>
    <div className="cover-preview__panel">
      <header><strong>{title}</strong><button className="icon-button" type="button" aria-label="Закрыть обложку" onClick={onClose}><X size={24} /></button></header>
      {failed ? <p role="status">Не удалось загрузить обложку</p> : <img src={source} alt={`Обложка: ${title}`} onError={() => source !== fallbackUrl ? setSource(fallbackUrl) : setFailed(true)} />}
    </div>
  </dialog>, document.body)
}
