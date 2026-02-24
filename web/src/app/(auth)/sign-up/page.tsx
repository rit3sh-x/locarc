import { requireNoAuth } from "@/lib/auth-utils";
import { SignUpView } from "@/modules/auth/ui/views/sign-up-view";

const Page = async (): Promise<React.JSX.Element> => {
    await requireNoAuth();

    return <SignUpView />;
};

export default Page;
