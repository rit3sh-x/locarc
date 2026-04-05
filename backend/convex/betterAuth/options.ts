import { type BetterAuthOptions } from "better-auth";
import { admin, username } from "better-auth/plugins";
import { ROLES, ROLE_VALUES, ac, ROLE_MAP } from "../lib/roles";

export const customOptions = {
    plugins: [
        username({
            maxUsernameLength: 20,
            minUsernameLength: 5,
        }),
        admin({
            ac,
            adminRoles: ROLES.ADMIN,
            defaultRole: ROLES.USER,
            roles: ROLE_MAP,
        }),
    ] as const,
    user: {
        additionalFields: {
            organizationSlug: {
                type: "string",
                input: true,
                required: true,
            },
            started: {
                type: "boolean",
                input: false,
                required: true,
                defaultValue: false,
            },
            role: {
                type: ROLE_VALUES,
                defaultValue: ROLES.USER,
                input: false,
                required: true,
            },
        },
    },
} satisfies BetterAuthOptions;
