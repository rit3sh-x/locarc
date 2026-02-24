import { requireAdmin } from "@/lib/auth-utils";
import { DashboardLayout } from "@/modules/dashboard/ui/layouts/dashboard-layout";

interface Props {
    children: React.ReactNode;
}

const Layout = async ({ children }: Props): Promise<React.JSX.Element> => {
    await requireAdmin();

    return <DashboardLayout>{children}</DashboardLayout>;
};

export default Layout;
