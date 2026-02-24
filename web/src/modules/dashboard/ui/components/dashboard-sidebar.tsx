"use client";

import { LogOutIcon, MapIcon, WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
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
} from "@/components/ui/sidebar";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import type { LucideIcon } from "lucide-react";
import type { Route } from "next";

type SidebarConfigItem = {
    title: string;
    url: Route;
    icon: LucideIcon;
};

const configuration: SidebarConfigItem[] = [
    {
        title: "Map",
        url: "/map",
        icon: MapIcon,
    },
    {
        title: "Controllers",
        url: "/controllers",
        icon: WorkflowIcon,
    },
];

export const DashboardSidebar = (): React.JSX.Element => {
    const pathname = usePathname();
    const router = useRouter();

    const isActive = (url: string) => {
        if (url === "/") return pathname === "/";
        return pathname.startsWith(url);
    };

    return (
        <Sidebar className="group" collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            render={
                                <Link
                                    href="/map"
                                    className="flex items-center justify-center gap-2"
                                />
                            }
                        >
                            <Image
                                src="/logo.png"
                                alt="LocArc"
                                width={24}
                                height={24}
                                priority
                                className="p-0.5 bg-neutral-50 rounded-xs"
                            />
                            <p className="text-lg font-bold group-data-[collapsible=icon]:hidden!">
                                AIMS
                            </p>
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
                                                "bg-[#0b63f3]! text-sidebar-primary-foreground! hover:bg-[#0b63f3]/90!"
                                        )}
                                        render={<Link href={item.url} />}
                                    >
                                        <item.icon className="size-4" />
                                        <span>{item.title}</span>
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
                                authClient.signOut({
                                    fetchOptions: {
                                        onSuccess: () => {
                                            router.push("/login");
                                        },
                                    },
                                });
                            }}
                        >
                            <LogOutIcon className="size-4" />
                            Sign Out
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
        </Sidebar>
    );
};
