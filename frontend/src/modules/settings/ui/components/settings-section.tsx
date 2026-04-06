import { AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'

interface SettingsSectionProps {
    value: string
    title: string
    description: string
    fieldCount: number
    children: React.ReactNode
}

export const SettingsSection = ({
    value,
    title,
    description,
    fieldCount,
    children,
}: SettingsSectionProps) => (
    <AccordionItem value={value}>
        <AccordionTrigger className="hover:no-underline">
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tracking-tight">{title}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                        {fieldCount}
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-normal leading-relaxed">
                    {description}
                </p>
            </div>
        </AccordionTrigger>
        <AccordionContent>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {children}
            </div>
        </AccordionContent>
    </AccordionItem>
)
