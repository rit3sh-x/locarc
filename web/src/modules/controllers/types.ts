import { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@backend/api";

export type ControllersOutput = FunctionReturnType<
    typeof api.private.controller.getMany
>;

export type Controller = ControllersOutput["page"][number];

export type AddControllerInput = FunctionArgs<
    typeof api.private.controller.create
>;

export type ModifyControllerInput = FunctionArgs<
    typeof api.private.controller.update
>;

export type RemoveControllerInput = FunctionArgs<
    typeof api.private.controller.remove
>;
