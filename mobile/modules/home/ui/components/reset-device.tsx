import { Alert } from 'react-native'
import { Button } from '@/components/ui/button'
import HackrfModule from '~/native'
import { RotateCcwIcon } from 'lucide-react-native'
import { useState } from 'react'

export const ResetDevice = () => {
    const [loading, setLoading] = useState(false)

    const handleReset = async () => {
        if (loading) return
        setLoading(true)
        try {
            const rc = await HackrfModule.resetDevice()
            Alert.alert('HackRF reset', `Device reboot requested (rc=${rc}).`)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            Alert.alert('Reset failed', msg)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Button
            variant={'ghost'}
            className="rounded-full p-2 border border-border"
            onPress={handleReset}
            disabled={loading}
        >
            <RotateCcwIcon />
        </Button>
    )
}
