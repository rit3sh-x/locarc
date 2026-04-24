import {
    HistoryIcon,
    LogOutIcon,
    MapIcon,
    RadioIcon,
    Settings2Icon,
    WorkflowIcon,
} from 'lucide-react'
import { Link, useLocation } from '@tanstack/react-router'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { authClient } from '@/lib/auth-client'
import type { LucideIcon } from 'lucide-react'
import type { Route } from '@/types'

type SidebarConfigItem = {
    title: string
    url: Route
    icon: LucideIcon
}

const configuration: SidebarConfigItem[] = [
    {
        title: 'Map',
        url: '/map',
        icon: MapIcon,
    },
    {
        title: 'Replay',
        url: '/replay',
        icon: HistoryIcon,
    },
    {
        title: 'SDR',
        url: '/sdr',
        icon: RadioIcon,
    },
    {
        title: 'Controllers',
        url: '/controllers',
        icon: WorkflowIcon,
    },
    {
        title: 'Settings',
        url: '/settings',
        icon: Settings2Icon,
    },
]

export const DashboardSidebar = (): React.JSX.Element => {
    const pathname = useLocation({
        select: (location) => location.pathname,
    })

    const isActive = (url: string) => {
        if (url === '/') return pathname === '/'
        return pathname.startsWith(url)
    }

    return (
        <Sidebar className="group" collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link to="/map" className="flex items-center justify-center gap-2">
                                <img
                                    src="/logo.png"
                                    alt="LocArc"
                                    width={24}
                                    height={24}
                                    className="p-0.5 bg-neutral-50 rounded-xs"
                                />
                                <p className="text-lg font-bold group-data-[collapsible=icon]:hidden!">
                                    AIMS
                                </p>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Manage</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {configuration.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton
                                        isActive={isActive(item.url)}
                                        className={cn(
                                            isActive(item.url) &&
                                                'bg-[#0b63f3]! text-sidebar-primary-foreground! hover:bg-[#0b63f3]/90!',
                                        )}
                                        asChild
                                    >
                                        <Link to={item.url}>
                                            <item.icon className="size-4" />
                                            <span>{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            onClick={() => {
                                authClient.signOut()
                            }}
                        >
                            <LogOutIcon className="size-4" />
                            Sign Out
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    )
}
