import { useState } from 'react'
import { View } from 'react-native'
import { z } from 'zod'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const formSchema = z.object({
    username: z.string().min(3, 'Minimum 3 characters'),
    password: z.string().min(8, 'Minimum 8 characters'),
})

export type LoginFormValues = z.infer<typeof formSchema>

interface LoginFormProps {
    onSubmit: (values: LoginFormValues) => Promise<void>
}

export const LoginForm = ({ onSubmit }: LoginFormProps) => {
    const [showPassword, setShowPassword] = useState(false)

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: '',
            password: '',
        },
    })

    const onFormSubmit = handleSubmit(async (data: LoginFormValues) => {
        await onSubmit(data)
    })

    return (
        <View className="w-full max-w-md px-6 flex flex-col gap-6">
            <View className="items-center mb-8">
                <Text className="text-3xl font-bold tracking-tight text-foreground mb-2">
                    Welcome back!
                </Text>
                <Text className="text-muted-foreground text-sm">Please enter your details</Text>
            </View>

            <View>
                <Label className="text-sm font-medium mb-1.5">Username</Label>
                <Controller
                    control={control}
                    name="username"
                    render={({ field }) => (
                        <Input
                            {...field}
                            onChangeText={field.onChange}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="johndoe"
                        />
                    )}
                />
                {errors.username && (
                    <Text className="text-destructive text-xs mt-1">{errors.username.message}</Text>
                )}
            </View>

            <View>
                <Label className="text-sm font-medium mb-1.5">Password</Label>
                <View className="relative">
                    <Controller
                        control={control}
                        name="password"
                        render={({ field }) => (
                            <Input
                                {...field}
                                onChangeText={field.onChange}
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                placeholder="********"
                            />
                        )}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        onPress={() => setShowPassword((p) => !p)}
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                    >
                        {showPassword ? (
                            <EyeOff size={18} color="#9ca3af" />
                        ) : (
                            <Eye size={18} color="#9ca3af" />
                        )}
                    </Button>
                </View>
                {errors.password && (
                    <Text className="text-destructive text-xs mt-1">{errors.password.message}</Text>
                )}
            </View>

            <Button onPress={onFormSubmit} disabled={isSubmitting}>
                <Text>{isSubmitting ? 'Logging in...' : 'Login'}</Text>
            </Button>
        </View>
    )
}
