import { createAuthClient } from 'better-auth/react'
import {
    adminClient,
    usernameClient,
    inferAdditionalFields,
    customSessionClient,
} from 'better-auth/client/plugins'
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins'
import type { Auth } from '@backend/types'
import { ENV } from 'varlock/env'

export const authClient = createAuthClient({
    baseURL: ENV.VITE_CONVEX_SITE_URL,
    plugins: [
        customSessionClient<Auth>(),
        inferAdditionalFields<Auth>(),
        usernameClient(),
        adminClient(),
        convexClient(),
        crossDomainClient(),
    ],
})
