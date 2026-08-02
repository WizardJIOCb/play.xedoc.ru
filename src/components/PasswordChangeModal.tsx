import { KeyRound, LoaderCircle, LockKeyhole, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { setAccountPassword } from '../lib/api'

export function PasswordChangeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) return
    setCurrentPassword(''); setPassword(''); setConfirmation(''); setError(''); setSaved(false); setLoading(false)
  }, [open])

  if (!open) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaved(false)
    if (password !== confirmation) { setError('Новые пароли не совпадают'); return }
    setLoading(true)
    try {
      await setAccountPassword(password, currentPassword)
      setSaved(true); setCurrentPassword(''); setPassword(''); setConfirmation('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось изменить пароль')
    } finally { setLoading(false) }
  }

  return <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="password-modal" role="dialog" aria-modal="true" aria-labelledby="password-change-title" onSubmit={(event) => void submit(event)}>
      <button className="icon-button password-modal__close" type="button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
      <div className="connect-modal__symbol"><KeyRound size={26} /></div>
      <span className="eyebrow">БЕЗОПАСНОСТЬ ПРОФИЛЯ</span>
      <h2 id="password-change-title">Изменить пароль</h2>
      <p>Укажите текущий пароль и придумайте новый — не короче 10 символов.</p>
      <label><LockKeyhole size={18} /><input type="password" autoFocus value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Текущий пароль" autoComplete="current-password" /></label>
      <label><KeyRound size={18} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Новый пароль" autoComplete="new-password" /></label>
      <label><KeyRound size={18} /><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Повторите новый пароль" autoComplete="new-password" /></label>
      <button className="primary-button" type="submit" disabled={!currentPassword || password.length < 10 || confirmation.length < 10 || loading}>{loading && <LoaderCircle className="spin" size={18} />} Сохранить новый пароль</button>
      {saved && <span className="form-success">Пароль изменён</span>}
      {error && <span className="form-error">{error}</span>}
    </form>
  </div>
}
