import { ChevronRight, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { loginAccount, registerAccount } from '../lib/api'
import { trackGoal } from '../lib/analytics'

function usernameError(value: string, mode: 'login' | 'register') {
  const username = value.trim()
  if (username.includes('@')) return mode === 'register'
    ? 'Введите короткий логин, а не email. Например: rakisolo или marat.ismailov.'
    : 'Для входа используйте логин без @ — email в XEDOC не используется.'
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) return 'Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание.'
  return ''
}

export function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const invalidUsername = usernameError(username, mode)
    if (invalidUsername) { setError(invalidUsername); return }
    setLoading(true)
    try {
      if (mode === 'register') await registerAccount(username.trim(), displayName.trim(), password)
      else await loginAccount(username.trim(), password)
      trackGoal(mode === 'register' ? 'auth_register' : 'auth_login')
      onAuthenticated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось войти')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="access-gate auth-gate">
      <div className="access-gate__glow" />
      <form onSubmit={(event) => void submit(event)}>
        <span className="brand__mark">X</span>
        <span className="eyebrow">XEDOC PLAY · ВАША МУЗЫКА</span>
        <h1>{mode === 'login' ? 'С возвращением.' : 'Создайте свой профиль.'}</h1>
        <p>{mode === 'login' ? 'Плейлисты, музыкальный вкус и подключения останутся только в вашем аккаунте.' : 'После регистрации подключите Яндекс Музыку и перенесите музыкальный вкус из VK.'}</p>
        <div className="auth-gate__tabs" role="tablist" aria-label="Вход или регистрация">
          <button className={mode === 'login' ? 'is-active' : ''} type="button" onClick={() => { setMode('login'); setError('') }}>Вход</button>
          <button className={mode === 'register' ? 'is-active' : ''} type="button" onClick={() => { setMode('register'); setError('') }}>Регистрация</button>
        </div>
        {mode === 'register' && <label><UserRound size={18} /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Как к вам обращаться" autoComplete="name" autoFocus /></label>}
        <label><UserRound size={18} /><input value={username} onChange={(event) => { setUsername(event.target.value); setError('') }} placeholder={mode === 'register' ? 'Логин (не email)' : 'Логин'} autoComplete="username" autoFocus={mode === 'login'} /></label>
        <label><LockKeyhole size={18} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Пароль" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        <button className="primary-button" type="submit" disabled={loading || username.length < 3 || password.length < (mode === 'register' ? 10 : 1) || (mode === 'register' && !displayName.trim())}>
          {loading ? <LoaderCircle className="spin" size={18} /> : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          {!loading && <ChevronRight size={18} />}
        </button>
        {error && <span className="form-error">{error}</span>}
        <small>{mode === 'register' ? 'Логин нужен для входа и виден в профиле, поэтому email не используется. Пароль — не короче 10 символов.' : 'Ваш пароль не передаётся музыкальным сервисам.'}</small>
      </form>
    </main>
  )
}
