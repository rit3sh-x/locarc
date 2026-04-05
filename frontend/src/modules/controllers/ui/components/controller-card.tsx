import { useState } from 'react'
import { MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Controller } from '../../types'
import { formatDistanceToNow } from 'date-fns'

interface ControllerCardProps {
    controller: Controller
    onView?: (controller: Controller) => void
    onEdit?: (controller: Controller) => void
    onDelete?: (controller: Controller) => void
}

export const ControllerCard = ({
    controller,
    onView,
    onEdit,
    onDelete,
}: ControllerCardProps): React.JSX.Element => {
    const [isMenuOpen, setIsMenuOpen] = useState(false)

    const handleCardClick = () => {
        if (!isMenuOpen) {
            onView?.(controller)
        }
    }

    return (
        <Card
            className="p-4 space-y-2 cursor-pointer hover:shadow-md transition-shadow"
            onClick={handleCardClick}
        >
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">{controller.name}</h3>

                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                        Controller
                    </Badge>

                    <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                        <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onEdit?.(controller)
                                    setIsMenuOpen(false)
                                }}
                            >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onDelete?.(controller)
                                    setIsMenuOpen(false)
                                }}
                                className="text-destructive"
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
                <div>
                    <span className="font-medium text-foreground">Latitude:</span>{' '}
                    {controller.latitude.toFixed(6)}
                </div>

                <div>
                    <span className="font-medium text-foreground">Longitude:</span>{' '}
                    {controller.longitude.toFixed(6)}
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                        Created{' '}
                        {formatDistanceToNow(new Date(controller.createdAt), {
                            addSuffix: true,
                        })}
                    </div>

                    <div className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                        Updated{' '}
                        {formatDistanceToNow(new Date(controller.updatedAt), {
                            addSuffix: true,
                        })}
                    </div>
                </div>
            </div>
        </Card>
    )
}
