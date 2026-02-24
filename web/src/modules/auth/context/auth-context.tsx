import type { Dispatch, SetStateAction } from "react";
import {
    createContext,
    useContext,
    useState,
    ReactNode,
    useCallback,
} from "react";

export type AuthLayoutContext = {
    showPassword: boolean;
    setShowPassword: Dispatch<SetStateAction<boolean>>;
    isTyping: boolean;
    setIsTyping: Dispatch<SetStateAction<boolean>>;
    passwordExist: boolean;
    setPasswordExist: Dispatch<SetStateAction<boolean>>;
    reset: () => void;
};

export const AuthContext = createContext<AuthLayoutContext | undefined>(
    undefined
);

export const AuthProvider = ({
    children,
}: {
    children: ReactNode;
}): React.JSX.Element => {
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [isTyping, setIsTyping] = useState<boolean>(false);
    const [passwordExist, setPasswordExist] = useState<boolean>(false);

    const reset = useCallback(() => {
        setIsTyping(false);
        setPasswordExist(false);
        setShowPassword(false);
    }, []);

    const value: AuthLayoutContext = {
        showPassword,
        setShowPassword,
        isTyping,
        setIsTyping,
        passwordExist,
        setPasswordExist,
        reset,
    };

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
};

export const useAuthLayoutContext = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error(
            "useAuthLayoutContext must be used within an AuthProvider"
        );
    }
    return context;
};
