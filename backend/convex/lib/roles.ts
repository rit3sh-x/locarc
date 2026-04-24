import { createAccessControl, type Role } from "better-auth/plugins/access";

export const ROLES = {
    ADMIN: "ADMIN",
    USER: "USER",
} as const;

export const ROLE_VALUES = Object.values(ROLES) as [string, ...string[]];

const statement = {
    user: ["create", "list", "update", "delete", "ban", "impersonate"],
    session: ["list", "terminate"],
    controller: ["list", "create", "getOne", "update", "delete", "location"],
    job: ["get"],
    measurement: ["create"],
    profile: ["update", "get"],
    localization: ["toggle", "stream", "replay"],
    sdr: ["list"],
    settings: ["read", "update"]
} as const;

export const ac = createAccessControl(statement);

export const ROLE_MAP = {
    [ROLES.ADMIN]: ac.newRole({
        user: ["create", "list", "update", "delete", "ban", "impersonate"],
        session: ["list", "terminate"],
        controller: ["list", "create", "update", "delete"],
        profile: ["update", "get"],
        localization: ["toggle", "stream", "replay"],
        sdr: ["list"],
        settings: ["read", "update"]
    }),
    [ROLES.USER]: ac.newRole({
        controller: ["getOne", "location"],
        job: ["get"],
        measurement: ["create"],
    }),
} as Record<string, Role>;

export type PermissionStatement = typeof statement;

export type PermissionRequest = {
    [K in keyof PermissionStatement]?: PermissionStatement[K][number][];
};
