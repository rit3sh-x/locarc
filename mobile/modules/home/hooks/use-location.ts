import { useEffect, useRef, useCallback } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@backend/api'
import * as Location from 'expo-location'

const LOCATION_INTERVAL_MS = 10 * 60 * 1000
const DEFAULT_LAT = -1
const DEFAULT_LON = -1

export function useLocation() {
    const controller = useQuery(api.public.controller.getController)
    const submitLocation = useMutation(api.public.controller.submitLocation)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const submittingRef = useRef(false)

    const pushLocation = useCallback(async () => {
        if (submittingRef.current) return
        submittingRef.current = true

        try {
            const { status } = await Location.requestForegroundPermissionsAsync()
            if (status !== 'granted') return

            const position = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            })

            await submitLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
            })
        } catch (err) {
            console.error('Location push failed:', err)
        } finally {
            submittingRef.current = false
        }
    }, [submitLocation])

    useEffect(() => {
        if (!controller) return

        const isDefault =
            controller.latitude === DEFAULT_LAT && controller.longitude === DEFAULT_LON

        if (isDefault) {
            pushLocation()
        }

        intervalRef.current = setInterval(pushLocation, LOCATION_INTERVAL_MS)

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
    }, [controller, pushLocation])
}
