import { SearchFilter } from '@/components/search-filter'
import { useDebouncedSearch } from '@/hooks/use-debounced-search'
import { useControllersParams } from '../../hooks/use-controllers-params'
import { NameFilter } from './name-filter'

export const ControllerFilters = (): React.JSX.Element => {
    const [params, setParams] = useControllersParams()
    const { search } = params

    const hasAnyFilters = !!search

    const updateSearch = (patch: Partial<typeof params>) => {
        setParams(patch)
    }

    const onClear = () => {
        setParams({
            search: '',
        })
    }

    const debouncedName = useDebouncedSearch(search, (value) => updateSearch({ search: value }))

    return (
        <div className="border rounded-md bg-card overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between bg-muted/30">
                <p className="font-semibold text-sm">Filters</p>
                {hasAnyFilters && (
                    <button
                        className="underline cursor-pointer text-xs"
                        onClick={onClear}
                        type="button"
                    >
                        Clear
                    </button>
                )}
            </div>

            <SearchFilter title="Search" className="border-b-0">
                <NameFilter value={debouncedName.value} onChange={debouncedName.onChange} />
            </SearchFilter>
        </div>
    )
}
