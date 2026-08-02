import { Check, Copy, ExternalLink, LoaderCircle, LockKeyhole, Music2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { pollDeviceAuth, startDeviceAuth } from '../lib/api'
import type { DeviceAuthStart } from '../types'

export function ConnectModal({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: () => void }) {
  const [auth, setAuth] = useState<DeviceAuthStart>()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<number | null>(null)
  const expiryRef = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const stopPolling = () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current)
    if (expiryRef.current !== null) window.clearTimeout(expiryRef.current)
    pollRef.current = null
    expiryRef.current = null
  }

  useEffect(() => {
    if (open) {
      window.setTimeout(() => closeRef.current?.focus(), 30)
      const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }
    stopPolling()
    setAuth(undefined)
    setCopied(false)
    setError('')
    setLoading(false)
    return undefined
  }, [open, onClose])

  useEffect(() => () => stopPolling(), [])

  if (!open) return null

  const begin = async () => {
    stopPolling()
    setLoading(true)
    setError('')
    try {
      const result = await startDeviceAuth()
      setAuth(result)
      window.open(result.verificationUrl, '_blank', 'noopener,noreferrer')
      const poll = () => {
        void pollDeviceAuth(result.deviceId).then((status) => {
          if (!status.connected) return
          stopPolling()
          setAuth(undefined)
          onConnected()
          onClose()
        }).catch((reason) => {
          stopPolling()
          setError(reason instanceof Error ? reason.message : 'Подключение прервано. Получите новый код.')
        })
      }
      pollRef.current = window.setInterval(() => {
        poll()
      }, Math.max(result.interval, 3) * 1000)
      expiryRef.current = window.setTimeout(() => {
        stopPolling()
        setAuth(undefined)
        setError('Код подключения истёк. Получите новый код.')
      }, Math.max(result.expiresIn, 1) * 1000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось начать подключение')
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    if (!auth) return
    await navigator.clipboard.writeText(auth.userCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <button ref={closeRef} className="icon-button connect-modal__close" type="button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
        <div className="connect-modal__symbol"><Music2 size={28} /></div>
        <span className="eyebrow">ОДНО БЕЗОПАСНОЕ ПОДКЛЮЧЕНИЕ</span>
        <h2 id="connect-title">Ваша музыка уже здесь</h2>
        <p>Подключите Яндекс Музыку через официальную страницу входа. Пароль никогда не попадает в XEDOC Play.</p>

        {!auth ? (
          <button className="primary-button connect-modal__button" type="button" onClick={() => void begin()} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={19} /> : <ExternalLink size={19} />}
            Получить код подключения
          </button>
        ) : (
          <div className="connect-modal__code-block">
            <small>Введите этот код на странице Яндекса</small>
            <button type="button" onClick={() => void copy()}><strong>{auth.userCode}</strong>{copied ? <Check size={19} /> : <Copy size={19} />}</button>
            <a href={auth.verificationUrl} target="_blank" rel="noreferrer">Открыть страницу подключения <ExternalLink size={15} /></a>
            <span><LoaderCircle className="spin" size={16} /> Ждём подтверждения…</span>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <footer><LockKeyhole size={15} /> Токен шифруется и хранится только на сервере XEDOC Play.</footer>
      </section>
    </div>
  )
}
