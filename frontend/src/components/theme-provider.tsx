import { useState, useEffect, useMemo, useCallback } from 'react'
import { ThemeContext } from './theme-context'
import type { Theme } from './theme-context'

const MEDIA = '(prefers-color-scheme: dark)'
const VALID_THEMES = new Set<string>(['dark', 'light', 'system'])
const STORAGE_KEY = 'theme'

function resolve(theme: Theme): 'dark' | 'light' {
    return theme === 'system' ? (window.matchMedia(MEDIA).matches ? 'dark' : 'light') : theme
}

function applyTheme(theme: Theme) {
    const root = document.documentElement
    const resolved = resolve(theme)

    const style = document.createElement('style')
    style.textContent =
        '*,*::before,*::after{transition:none!important;-webkit-transition:none!important}'
    document.head.appendChild(style)

    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
    root.style.colorScheme = resolved

    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => style.remove())
    })

    requestAnimationFrame(() => {
        const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        if (meta) {
            meta.content = getComputedStyle(root).getPropertyValue('--background').trim()
        }
    })
}

function readStored(): Theme {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored && VALID_THEMES.has(stored) ? (stored as Theme) : 'system'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeRaw] = useState<Theme>(readStored)

    const setTheme = useCallback((next: Theme) => {
        localStorage.setItem(STORAGE_KEY, next)
        setThemeRaw(next)
    }, [])

    useEffect(() => {
        applyTheme(theme)

        if (theme !== 'system') return

        const mq = window.matchMedia(MEDIA)
        const onChange = () => applyTheme('system')
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [theme])

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return

            const t = e.target
            if (
                t instanceof HTMLElement &&
                (t.isContentEditable || t.closest("input,textarea,select,[contenteditable='true']"))
            )
                return

            if (e.key.toLowerCase() !== 'd') return

            setThemeRaw((cur) => {
                const next = resolve(cur) === 'dark' ? 'light' : 'dark'
                localStorage.setItem(STORAGE_KEY, next)
                return next
            })
        }

        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.storageArea !== localStorage || e.key !== STORAGE_KEY) return
            setThemeRaw(
                e.newValue && VALID_THEMES.has(e.newValue) ? (e.newValue as Theme) : 'system',
            )
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
