import { useMutation, useQuery } from "convex/react";
import { api } from "@backend/api";
import { useState } from "react";
import { UpdateProfileInput } from "../types";
import { toast } from "sonner";

export const useControllerInfo = () => {
    return useQuery(api.public.controller.getController, {});
};

export const useUserInfo = () => {
    return useQuery(api.private.user.getProfile, {});
};

export const useUpdateProfile = () => {
    const [isPending, setIsPending] = useState(false);
    const updateProfileMutation = useMutation(api.private.user.updateProfile);

    const updateProfile = async (input: UpdateProfileInput) => {
        setIsPending(true);
        try {
            await updateProfileMutation(input);
            toast.success("Updated profile");
        } catch {
            toast.error("Failed to update profile");
        } finally {
            setIsPending(false);
        }
    };

    return { updateProfile, isPending };
};
