import { createContext, useContext, type ReactNode } from 'react'

interface AuthPromptValue {
  authenticated: boolean
  requireAuth: () => boolean
}

const AuthPromptContext = createContext<AuthPromptValue>({
  authenticated: true,
  requireAuth: () => true,
})

export function AuthPromptProvider({ authenticated, onRequireAuth, children }: { authenticated: boolean; onRequireAuth: () => void; children: ReactNode }) {
  const requireAuth = () => {
    if (authenticated) return true
    onRequireAuth()
    return false
  }

  return <AuthPromptContext.Provider value={{ authenticated, requireAuth }}>{children}</AuthPromptContext.Provider>
}

export function useAuthPrompt() {
  return useContext(AuthPromptContext)
}
