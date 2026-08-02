import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './AuthGate'

const api = vi.hoisted(() => ({ loginAccount: vi.fn(), registerAccount: vi.fn() }))
vi.mock('../lib/api', () => ({ loginAccount: api.loginAccount, registerAccount: api.registerAccount }))

describe('AuthGate registration', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('explains that an email cannot be used as a public login', async () => {
    render(<AuthGate onAuthenticated={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Регистрация' }))
    fireEvent.change(screen.getByPlaceholderText('Как к вам обращаться'), { target: { value: 'Марат Исмаилов' } })
    fireEvent.change(screen.getByPlaceholderText('Логин (не email)'), { target: { value: 'rakisolo@gmail.com' } })
    fireEvent.change(screen.getByPlaceholderText('Пароль'), { target: { value: 'secure-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
    expect(await screen.findByText(/Введите короткий логин, а не email/)).toBeInTheDocument()
    expect(api.registerAccount).not.toHaveBeenCalled()
  })
})
