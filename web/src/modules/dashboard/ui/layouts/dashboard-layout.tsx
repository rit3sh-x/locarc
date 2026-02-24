import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "../components/dashboard-sidebar";
import { DashboardHeader } from "../components/dashboard-header";
import { cookies as getCookies } from "next/headers";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorUI } from "@/components/error-ui";

interface DashboardLayoutProps {
    children: React.ReactNode;
}

export const DashboardLayout = async ({
    children,
}: DashboardLayoutProps): Promise<React.JSX.Element> => {
    const cookies = await getCookies();
    const defaultOpen = cookies.get("sidebar_state")?.value === "true";

    return (
        <ErrorBoundary fallback={<ErrorUI />}>
            <SidebarProvider defaultOpen={defaultOpen}>
                <DashboardSidebar />
                <SidebarInset className="rounded-xl overflow-hidden">
                    <DashboardHeader />
                    <main className="flex-1 overflow-y-auto min-h-0">
                        {children}
                    </main>
                </SidebarInset>
            </SidebarProvider>
        </ErrorBoundary>
    );
};
