"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserProfile } from "./user-profile";
import { usePathname } from "next/navigation";

const getPageTitle = (pathname: string): string => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return "Dashboard";
    return formatSegment(segments[0]!);
};

const formatSegment = (segment: string) =>
    segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const DashboardHeader = (): React.JSX.Element => {
    const pathname = usePathname();
    const pageTitle = getPageTitle(pathname);

    return (
        <header className="flex w-full justify-between items-center h-14 shrink-0 gap-2 px-4 bg-background border-b">
            <div className="flex items-center justify-center gap-1">
                <SidebarTrigger />
                <p className="text-xl hidden md:flex">{pageTitle}</p>
            </div>
            <UserProfile />
        </header>
    );
};
