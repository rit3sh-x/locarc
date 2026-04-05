import { createFileRoute } from '@tanstack/react-router'
import { SignUpView } from '@/modules/auth/ui/views/sign-up-view'

export const Route = createFileRoute('/(auth)/signup')({
    component: SignUpView,
})
