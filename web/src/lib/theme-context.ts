import { createContext, useContext } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

export const ThemeContext = createContext<{
  theme: ThemeChoice
  resolved: 'light' | 'dark'
  setTheme: (t: ThemeChoice) => void
} | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
