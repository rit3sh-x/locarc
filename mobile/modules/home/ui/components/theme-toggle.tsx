import { Appearance } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Switch } from "@/components/ui/switch";

export const ThemeToggle = () => {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === "dark";

    const toggle = () => {
        Appearance.setColorScheme(isDark ? "light" : "dark");
    };

    return <Switch checked={isDark} onCheckedChange={toggle} />;
};
