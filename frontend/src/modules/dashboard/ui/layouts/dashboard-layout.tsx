import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { DashboardSidebar } from '../components/dashboard-sidebar'
import { DashboardHeader } from '../components/dashboard-header'

const SIDEBAR_COOKIE_NAME = 'sidebar_state'

function getSidebarDefaultOpen(): boolean {
    if (typeof document === 'undefined') return true

    const cookie = document.cookie
        .split('; ')
        .find((row) => row.startsWith(`${SIDEBAR_COOKIE_NAME}=`))

    if (!cookie) return true
    return cookie.split('=')[1] === 'true'
}

interface DashboardLayoutProps {
    children: React.ReactNode
}

export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
    const defaultOpen = getSidebarDefaultOpen()

    return (
        <SidebarProvider defaultOpen={defaultOpen}>
            <DashboardSidebar />
            <SidebarInset className="rounded-xl overflow-hidden">
                <DashboardHeader />
                <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    )
}
