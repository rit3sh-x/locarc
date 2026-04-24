import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import type { Id } from '@backend/dataModel'
import type { SdrControllerOption } from '../../types'

interface ReadingFiltersProps {
    controllers: SdrControllerOption[]
    selected: Id<'controller'> | undefined
    onSelect: (id: Id<'controller'> | undefined) => void
}

const ALL = '__all__'

export const ReadingFilters = ({
    controllers,
    selected,
    onSelect,
}: ReadingFiltersProps): React.JSX.Element => {
    return (
        <div className="flex items-center gap-2">
            <Select
                value={selected ?? ALL}
                onValueChange={(v) => onSelect(v === ALL ? undefined : (v as Id<'controller'>))}
            >
                <SelectTrigger className="w-56">
                    <SelectValue placeholder="All controllers" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>All controllers</SelectItem>
                    {controllers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                            {c.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
