import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Merriweather } from "next/font/google";
import { ThemeProvider } from "@/providers/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ConvexClientProvider } from "@/providers/convex-client-provider";
import { getToken } from "@/lib/auth-server";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-sans",
    display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
    display: "swap",
});

const merriweather = Merriweather({
    subsets: ["latin"],
    weight: ["300", "400", "700"],
    variable: "--font-serif",
    display: "swap",
});

export const metadata: Metadata = {
    title: {
        default: "LocArc",
        template: "%s | LocArc",
    },

    icons: {
        icon: "/logo.png",
        apple: "/logo.png",
    },

    applicationName: "LocArc",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
};

const Layout = async ({
    children,
}: {
    children: React.ReactNode;
}): Promise<React.JSX.Element> => {
    const token = await getToken();
    return (
        <html lang="en" suppressHydrationWarning>
            <body
                className={`min-h-screen w-screen flex overflow-hidden antialiased bg-sidebar ${inter.variable} ${jetbrainsMono.variable} ${merriweather.variable}`}
            >
                <NuqsAdapter>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                    >
                        <ConvexClientProvider initialToken={token}>
                            <TooltipProvider>{children}</TooltipProvider>
                        </ConvexClientProvider>
                        <Toaster />
                    </ThemeProvider>
                </NuqsAdapter>
            </body>
        </html>
    );
};

export default Layout;
