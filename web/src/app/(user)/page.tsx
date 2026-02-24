import { requireUser } from "@/lib/auth-utils";
import { UserView } from "@/modules/dashboard/ui/views/user-view";

const Page = async (): Promise<React.JSX.Element> => {
    await requireUser();

    return <UserView />;
};

export default Page;
