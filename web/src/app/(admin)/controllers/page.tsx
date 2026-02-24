import { requireAdmin } from "@/lib/auth-utils";
import { ControllerView } from "@/modules/controllers/ui/views/controllers-view";

const Page = async (): Promise<React.JSX.Element> => {
    await requireAdmin();

    return <ControllerView />;
};

export default Page;
