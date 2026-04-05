import { signUpWithEmail } from '../../hooks/auth-handlers'
import { SignUpForm } from '../components/sign-up-form'
import type { SignUpFormValues } from '../components/sign-up-form'

export const SignUpView = () => {
    const handleSignup = async ({
        email,
        name,
        organizationSlug,
        password,
        username,
    }: SignUpFormValues) => {
        await signUpWithEmail({
            email,
            password,
            username,
            name,
            organizationSlug,
        })
    }

    return (
        <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
            <SignUpForm onSubmit={handleSignup} />
        </div>
    )
}
