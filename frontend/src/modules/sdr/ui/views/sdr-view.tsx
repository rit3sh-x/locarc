import { useState } from 'react'
import { ReadingFilters } from '../components/reading-filters'
import { ReadingList } from '../components/reading-list'
import { ReadingDetail } from '../components/reading-detail'
import { useSdrControllers } from '../../hooks/use-sdr'
import type { Id } from '@backend/dataModel'
import type { SdrReading } from '../../types'

export const SdrView = (): React.JSX.Element => {
    const { controllers } = useSdrControllers()
    const [selected, setSelected] = useState<Id<'controller'> | undefined>(undefined)
    const [detailOpen, setDetailOpen] = useState(false)
    const [detailReading, setDetailReading] = useState<SdrReading | null>(null)

    const handleView = (reading: SdrReading) => {
        setDetailReading(reading)
        setDetailOpen(true)
    }

    return (
        <div className="flex flex-col w-full h-full max-w-7xl gap-4 p-4 md:p-6 mx-auto">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h1 className="text-xl font-semibold">SDR Readings</h1>
                    <p className="text-sm text-muted-foreground">
                        Raw power spectra submitted by controllers. Auto-pruned after 24h.
                    </p>
                </div>
                <ReadingFilters
                    controllers={controllers}
                    selected={selected}
                    onSelect={setSelected}
                />
            </div>

            <ReadingList controllerId={selected} onView={handleView} />

            <ReadingDetail reading={detailReading} open={detailOpen} onOpenChange={setDetailOpen} />
        </div>
    )
}
