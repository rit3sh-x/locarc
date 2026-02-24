"use client";

import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import Link from "next/link";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthLayoutContext } from "../../context/auth-context";

export const formSchema = z.object({
    email: z.email("Invalid email"),
    password: z.string().min(8, "Minimum 8 characters"),
});

export type LoginFormValues = z.infer<typeof formSchema>;

interface LoginFormProps {
    onSubmit: (values: LoginFormValues) => Promise<void>;
}

export const LoginForm = ({ onSubmit }: LoginFormProps): React.JSX.Element => {
    const { setIsTyping, setPasswordExist, setShowPassword, showPassword } =
        useAuthLayoutContext();

    const form = useForm({
        defaultValues: {
            email: "",
            password: "",
        },
        validators: {
            onSubmit: formSchema,
        },
        onSubmit: async ({ value }) => {
            await onSubmit(value);
        },
    });

    return (
        <div className="w-full max-w-md py-4">
            <div className="text-center">
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
                    Welcome back!
                </h1>
                <p className="text-white/40 text-sm">
                    Please enter your details
                </p>
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.handleSubmit();
                }}
                className="space-y-6 flex flex-col items-center justify-center"
            >
                <form.Field name="email">
                    {(field) => {
                        const isInvalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid;

                        return (
                            <Field data-invalid={isInvalid}>
                                <FieldLabel className="text-white">
                                    Email
                                </FieldLabel>
                                <Input
                                    value={field.state.value ?? ""}
                                    onBlur={field.handleBlur}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value);
                                        setIsTyping(true);
                                        setTimeout(
                                            () => setIsTyping(false),
                                            600
                                        );
                                    }}
                                    className="text-white px-4"
                                    placeholder="john@example.com"
                                />
                                {isInvalid && (
                                    <FieldError
                                        errors={field.state.meta.errors}
                                    />
                                )}
                            </Field>
                        );
                    }}
                </form.Field>

                <form.Field name="password">
                    {(field) => {
                        const isInvalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid;

                        return (
                            <Field data-invalid={isInvalid}>
                                <FieldLabel className="text-white">
                                    Password
                                </FieldLabel>

                                <div className="relative">
                                    <Input
                                        type={
                                            showPassword ? "text" : "password"
                                        }
                                        value={field.state.value ?? ""}
                                        onBlur={field.handleBlur}
                                        data-lpignore="true"
                                        data-form-type="password"
                                        className="text-white px-4"
                                        placeholder="********"
                                        onChange={(e) => {
                                            field.handleChange(e.target.value);
                                            setPasswordExist(
                                                e.target.value.length > 0
                                            );
                                            setIsTyping(true);
                                            setTimeout(
                                                () => setIsTyping(false),
                                                600
                                            );
                                        }}
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowPassword((p) => !p)
                                        }
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white"
                                    >
                                        {showPassword ? (
                                            <EyeOffIcon className="size-4" />
                                        ) : (
                                            <EyeIcon className="size-4" />
                                        )}
                                    </button>
                                </div>

                                {isInvalid && (
                                    <FieldError
                                        errors={field.state.meta.errors}
                                    />
                                )}
                            </Field>
                        );
                    }}
                </form.Field>

                <form.Subscribe selector={(s) => s.canSubmit}>
                    {(canSubmit) => (
                        <Button
                            type="submit"
                            disabled={!canSubmit}
                            className="w-full bg-white text-black hover:bg-white/90 hover:text-black hover:border border-border"
                        >
                            Login
                        </Button>
                    )}
                </form.Subscribe>

                <Link
                    href="/sign-up"
                    className="relative text-sm text-white/40 transition-colors hover:text-white after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-white after:transition-transform after:duration-300 hover:after:scale-x-100"
                >
                    Sign up
                </Link>
            </form>
        </div>
    );
};
