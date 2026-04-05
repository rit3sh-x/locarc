import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { useTheme } from '@/hooks/use-theme'

export const TileController = () => {
    const map = useMap()
    const { theme } = useTheme()
    const lightRef = useRef<L.TileLayer | null>(null)
    const darkRef = useRef<L.TileLayer | null>(null)

    useEffect(() => {
        lightRef.current = L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            { crossOrigin: true },
        )

        darkRef.current = L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            { crossOrigin: true },
        )

        return () => {
            lightRef.current?.remove()
            darkRef.current?.remove()
        }
    }, [map])

    useEffect(() => {
        if (!lightRef.current || !darkRef.current) return

        if (theme === 'dark') {
            map.removeLayer(lightRef.current)
            darkRef.current.addTo(map)
        } else {
            map.removeLayer(darkRef.current)
            lightRef.current.addTo(map)
        }
    }, [theme, map])

    return null
}
