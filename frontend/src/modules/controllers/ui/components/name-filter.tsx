import { Input } from '@/components/ui/input'
import type { Dispatch, SetStateAction } from 'react'

interface NameFilterProps {
    value?: string
    onChange: Dispatch<SetStateAction<string>>
    placeholder?: string
}

export const NameFilter = ({
    value,
    onChange,
    placeholder = 'Search…',
}: NameFilterProps): React.JSX.Element => {
    const handleChange = (raw: string) => {
        const trimmed = raw.trim()

        if (trimmed === '') {
            onChange('')
        } else {
            onChange(trimmed)
        }
    }

    return (
        <Input
            type="text"
            value={value ?? ''}
            placeholder={placeholder}
            onChange={(e) => handleChange(e.target.value)}
        />
    )
}
