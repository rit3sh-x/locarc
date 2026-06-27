import { useEffect, useRef, useCallback } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@backend/api'
import * as Location from 'expo-location'

const LOCATION_INTERVAL_MS = 10 * 1000
const POSITION_EQUAL_EPSILON_DEG = 1e-5

export function useLocation() {
    const controller = useQuery(api.public.controller.getController)
    const submitLocation = useMutation(api.public.controller.submitLocation)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const submittingRef = useRef(false)
    const controllerRef = useRef(controller)

    useEffect(() => {
        controllerRef.current = controller
    }, [controller])

    const syncLocation = useCallback(async () => {
        if (submittingRef.current) return
        submittingRef.current = true

        try {
            const { status } = await Location.requestForegroundPermissionsAsync()
            if (status !== 'granted') return

            const position = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            })

            const { latitude, longitude } = position.coords
            const current = controllerRef.current

            if (
                current &&
                Math.abs(current.latitude - latitude) < POSITION_EQUAL_EPSILON_DEG &&
                Math.abs(current.longitude - longitude) < POSITION_EQUAL_EPSILON_DEG
            ) {
                return
            }

            await submitLocation({ latitude, longitude })
        } catch (err) {
            console.error('Location push failed:', err)
        } finally {
            submittingRef.current = false
        }
    }, [submitLocation])

    useEffect(() => {
        syncLocation()
        intervalRef.current = setInterval(syncLocation, LOCATION_INTERVAL_MS)

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
        }
    }, [syncLocation])
}
