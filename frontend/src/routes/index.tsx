import { createFileRoute } from '@tanstack/react-router'
import { useAuthRedirect } from '@/modules/auth/hooks/use-auth-redirect'

export const Route = createFileRoute('/')({ component: App })

function App() {
    const { isLoading } = useAuthRedirect()

    if (isLoading) return null

    return null
}
