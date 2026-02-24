import { FunctionReturnType } from "convex/server";
import { api } from "@backend/api";

type StreamResult = NonNullable<
    FunctionReturnType<typeof api.private.localization.stream>
>;

export type LocationWithBounds = StreamResult["locations"][number];

export type ControllerLocation = StreamResult["controllers"][number];

export type Location = {
    longitude: number;
    latitude: number;
};
