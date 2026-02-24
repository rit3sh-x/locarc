import { api } from "@backend/api";
import { FunctionArgs } from "convex/server";

export type UpdateProfileInput = FunctionArgs<
    typeof api.private.user.updateProfile
>;
