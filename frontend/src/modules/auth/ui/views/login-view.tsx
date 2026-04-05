import { loginWithPassword } from '../../hooks/auth-handlers'
import { LoginForm } from '../components/login-form'
import type { LoginFormValues } from '../components/login-form'

export const LoginView = (): React.JSX.Element => {
    const handleLogin = async ({ email, password }: LoginFormValues) => {
        await loginWithPassword({
            email,
            password,
        })
    }

    return (
        <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
            <LoginForm onSubmit={handleLogin} />
        </div>
    )
}
