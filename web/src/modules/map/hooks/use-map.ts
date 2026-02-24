import { api } from "@backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import type { LocationWithBounds, ControllerLocation } from "../types";

export const useToggle = () => {
    const [isPending, setIsPending] = useState(false);
    const toggleMutation = useMutation(api.private.localization.toggle);

    const toggle = async (isCurrentlyStarted: boolean) => {
        setIsPending(true);
        try {
            await toggleMutation();
            toast.success(
                isCurrentlyStarted ? "Recording stopped" : "Recording started"
            );
        } catch {
            toast.error("Failed to update recording state");
        } finally {
            setIsPending(false);
        }
    };

    return { toggle, isPending };
};

export const useLocations = (): {
    locations: LocationWithBounds[];
    controllers: ControllerLocation[];
} => {
    const data = useQuery(api.private.localization.stream, {});

    return {
        locations: data?.locations ?? [],
        controllers: data?.controllers ?? [],
    };
};
