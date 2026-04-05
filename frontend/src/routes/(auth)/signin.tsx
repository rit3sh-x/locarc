import { createFileRoute } from '@tanstack/react-router'
import { LoginView } from '@/modules/auth/ui/views/login-view'

export const Route = createFileRoute('/(auth)/signin')({
    component: LoginView,
})
