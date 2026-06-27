import { usePaginatedQuery, useConvex } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache'
import { useState, useCallback } from 'react'
import { api } from '@backend/api'
import type { Id } from '@backend/dataModel'
import { SDR_PAGE_SIZE } from '../constants'

export const useSdrReadings = (controllerId: Id<'controller'> | undefined) => {
    return usePaginatedQuery(
        api.private.sdr.list,
        { controllerId },
        { initialNumItems: SDR_PAGE_SIZE },
    )
}

export const useSdrControllers = () => {
    const controllers = useQuery(api.private.sdr.listControllers, {})
    return { controllers: controllers ?? [], isLoading: controllers === undefined }
}

export const useSdrExport = () => {
    const convex = useConvex()
    const [isExporting, setIsExporting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const exportCsv = useCallback(
        async (args: { fromMs?: number; toMs?: number; controllerId?: Id<'controller'> }) => {
            setIsExporting(true)
            setError(null)
            try {
                const result = await convex.query(api.private.sdr.exportCsv, args)
                const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                const stamp = new Date().toISOString().replace(/[:.]/g, '-')
                a.download = `sdr-readings-${stamp}.csv`
                document.body.appendChild(a)
                a.click()
                a.remove()
                URL.revokeObjectURL(url)
                return result
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                setError(msg)
                throw e
            } finally {
                setIsExporting(false)
            }
        },
        [convex],
    )

    return { exportCsv, isExporting, error }
}
