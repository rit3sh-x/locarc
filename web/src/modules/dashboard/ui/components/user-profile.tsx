"use client";

import { useState, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUserInfo, useUpdateProfile } from "../../hooks/use-user";

export function UserProfile(): React.JSX.Element {
    const { setTheme, theme } = useTheme();
    const userInfo = useUserInfo();
    const { updateProfile, isPending } = useUpdateProfile();

    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(userInfo?.name ?? "");
    const [editSlug, setEditSlug] = useState(userInfo?.organizationSlug ?? "");
    const [editUsername, setEditUsername] = useState(userInfo?.username ?? "");

    const snapshotRef = useRef<{
        name: string;
        organizationSlug: string;
        username: string;
    } | null>(null);

    const save = useCallback(async () => {
        if (isPending || !userInfo) return;

        snapshotRef.current = {
            name: userInfo.name ?? "",
            organizationSlug: userInfo.organizationSlug ?? "",
            username: userInfo.username ?? "",
        };

        try {
            await updateProfile({
                name: editName,
                organizationSlug: editSlug,
                username: editUsername,
            });
            setIsEditing(false);
        } catch {
            if (snapshotRef.current) {
                setEditName(snapshotRef.current.name);
                setEditSlug(snapshotRef.current.organizationSlug);
                setEditUsername(snapshotRef.current.username);
            }
            setIsEditing(false);
        }
    }, [isPending, userInfo, editName, editSlug, editUsername, updateProfile]);

    if (userInfo && !isEditing) {
        if (editName !== userInfo.name) setEditName(userInfo.name ?? "");
        if (editSlug !== userInfo.organizationSlug)
            setEditSlug(userInfo.organizationSlug ?? "");
        if (editUsername !== userInfo.username)
            setEditUsername(userInfo.username ?? "");
    }

    const inputBase =
        "h-auto p-1 border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none";

    if (!userInfo) {
        return <></>;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={(props) => (
                    <Button
                        variant="ghost"
                        className="flex px-4 py-2 rounded-full"
                        {...props}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-col text-left">
                                <span className="font-medium">{editName}</span>
                                <span className="text-xs text-muted-foreground">
                                    {editSlug}
                                </span>
                            </div>
                            <ChevronDown className="size-4" />
                        </div>
                    </Button>
                )}
            />

            <DropdownMenuContent
                align="end"
                className="space-y-1 min-w-56 z-50"
            >
                <div
                    onDoubleClick={() => !isPending && setIsEditing(true)}
                    className="px-2 py-1.5"
                >
                    {isEditing ? (
                        <div className="flex flex-col gap-2">
                            <div>
                                <label className="text-xs text-muted-foreground">
                                    Name
                                </label>
                                <Input
                                    disabled={isPending}
                                    value={editName}
                                    onChange={(e) =>
                                        setEditName(e.target.value)
                                    }
                                    onBlur={save}
                                    onKeyDown={(e) =>
                                        e.key === "Enter" && save()
                                    }
                                    autoFocus
                                    className={`${inputBase} text-sm font-medium`}
                                />
                            </div>

                            <div>
                                <label className="text-xs text-muted-foreground">
                                    Username
                                </label>
                                <Input
                                    disabled={isPending}
                                    value={editUsername}
                                    onChange={(e) =>
                                        setEditUsername(e.target.value)
                                    }
                                    onBlur={save}
                                    onKeyDown={(e) =>
                                        e.key === "Enter" && save()
                                    }
                                    className={`${inputBase} text-xs`}
                                />
                            </div>

                            <div>
                                <label className="text-xs text-muted-foreground">
                                    Organization Slug
                                </label>
                                <Input
                                    disabled={isPending}
                                    value={editSlug}
                                    onChange={(e) =>
                                        setEditSlug(e.target.value)
                                    }
                                    onBlur={save}
                                    onKeyDown={(e) =>
                                        e.key === "Enter" && save()
                                    }
                                    className={`${inputBase} text-xs`}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col cursor-pointer">
                            <span className="text-sm font-medium">
                                {editName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                @{editUsername} · {editSlug}
                            </span>
                            <span className="text-xs text-muted-foreground mt-0.5">
                                (double-click to edit)
                            </span>
                        </div>
                    )}
                </div>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                    onClick={() => setTheme("light")}
                    className={cn(theme === "light" && "rounded-sm bg-muted")}
                >
                    Light
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => setTheme("dark")}
                    className={cn(theme === "dark" && "rounded-sm bg-muted")}
                >
                    Dark
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => setTheme("system")}
                    className={cn(
                        theme !== "dark" &&
                            theme !== "light" &&
                            "rounded-sm bg-muted"
                    )}
                >
                    System
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
