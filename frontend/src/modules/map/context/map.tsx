import { createContext, useContext, useState } from 'react'
import type { Location } from '../types'

const MapCursorContext = createContext<{
    pos: Location | null
    setPos: (p: Location | null) => void
} | null>(null)

export function MapCursorProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
    const [pos, setPos] = useState<Location | null>(null)

    return <MapCursorContext.Provider value={{ pos, setPos }}>{children}</MapCursorContext.Provider>
}

export function useMapCursor() {
    const ctx = useContext(MapCursorContext)
    if (!ctx) throw new Error('useMapCursor must be used inside MapCursorProvider')
    return ctx
}
