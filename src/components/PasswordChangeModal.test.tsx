import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasswordChangeModal } from './PasswordChangeModal'

const api = vi.hoisted(() => ({ setAccountPassword: vi.fn() }))
vi.mock('../lib/api', () => ({ setAccountPassword: api.setAccountPassword }))

describe('PasswordChangeModal', () => {
  beforeEach(() => api.setAccountPassword.mockReset().mockResolvedValue(undefined))
  afterEach(cleanup)

  it('confirms the new password and sends the current password', async () => {
    render(<PasswordChangeModal open onClose={() => undefined} />)
    fireEvent.change(screen.getByPlaceholderText('Текущий пароль'), { target: { value: '28051961' } })
    fireEvent.change(screen.getByPlaceholderText('Новый пароль'), { target: { value: 'another-secure-password' } })
    fireEvent.change(screen.getByPlaceholderText('Повторите новый пароль'), { target: { value: 'another-secure-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить новый пароль' }))
    await waitFor(() => expect(api.setAccountPassword).toHaveBeenCalledWith('another-secure-password', '28051961'))
    expect(await screen.findByText('Пароль изменён')).toBeInTheDocument()
  })

  it('does not submit mismatching passwords', async () => {
    render(<PasswordChangeModal open onClose={() => undefined} />)
    fireEvent.change(screen.getByPlaceholderText('Текущий пароль'), { target: { value: '28051961' } })
    fireEvent.change(screen.getByPlaceholderText('Новый пароль'), { target: { value: 'another-secure-password' } })
    fireEvent.change(screen.getByPlaceholderText('Повторите новый пароль'), { target: { value: 'different-secure-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить новый пароль' }))
    expect(await screen.findByText('Новые пароли не совпадают')).toBeInTheDocument()
    expect(api.setAccountPassword).not.toHaveBeenCalled()
  })
})
