import { LoaderCircle, LockKeyhole } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { setAccountPassword } from '../lib/api'

export function PasswordSetupModal({ open, onSaved }: { open: boolean; onSaved: () => void }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  if (!open) return null
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('')
    try { await setAccountPassword(password); onSaved() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить пароль') }
    finally { setLoading(false) }
  }
  return <div className="overlay"><form className="password-modal" onSubmit={(event) => void submit(event)}><div className="connect-modal__symbol"><LockKeyhole size={26} /></div><span className="eyebrow">ЗАЩИТИТЕ СУЩЕСТВУЮЩИЙ ПРОФИЛЬ</span><h2>Создайте пароль для XEDOC</h2><p>Мы перенесли вашу музыку и историю в личный аккаунт. Задайте пароль, чтобы войти с другого устройства.</p><label><LockKeyhole size={18} /><input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Не короче 10 символов" autoComplete="new-password" /></label><button className="primary-button" type="submit" disabled={password.length < 10 || loading}>{loading && <LoaderCircle className="spin" size={18} />} Сохранить пароль</button>{error && <span className="form-error">{error}</span>}</form></div>
}
