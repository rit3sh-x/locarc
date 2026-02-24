import { AuthLayout } from "@/modules/auth/ui/layouts/auth-layout";
import { requireNoAuth } from "../../lib/auth-utils";

interface Props {
    children: React.ReactNode;
}

const Layout = async ({ children }: Props): Promise<React.JSX.Element> => {
    await requireNoAuth();

    return <AuthLayout>{children}</AuthLayout>;
};

export default Layout;
