"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

type ThemeProviderProps = React.PropsWithChildren<
    React.ComponentProps<typeof NextThemesProvider>
>;

export const ThemeProvider = ({
    children,
    ...props
}: ThemeProviderProps): React.JSX.Element => {
    return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
};
