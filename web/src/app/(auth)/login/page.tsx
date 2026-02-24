import { requireNoAuth } from "@/lib/auth-utils";
import { LoginView } from "@/modules/auth/ui/views/login-view";

const Page = async (): Promise<React.JSX.Element> => {
    await requireNoAuth();

    return <LoginView />;
};

export default Page;
