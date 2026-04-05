import { cn } from '@/lib/utils'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'

interface StockFilterProps {
    title: string
    className?: string
    children: React.ReactNode
}

export const SearchFilter = ({
    title,
    className,
    children,
}: StockFilterProps): React.JSX.Element => {
    const [isOpen, setIsOpen] = useState<boolean>(false)
    const Icon = isOpen ? ChevronDownIcon : ChevronRightIcon

    return (
        <div className={cn('p-4 border-b flex flex-col gap-2', className)}>
            <div
                onClick={() => setIsOpen((current) => !current)}
                className="flex items-center justify-between cursor-pointer"
            >
                <p className="font-medium">{title}</p>
                <Icon className="size-5" />
            </div>

            {isOpen && children}
        </div>
    )
}
