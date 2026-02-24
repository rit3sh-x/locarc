import { useQueryStates } from "nuqs";
import { controllersParams } from "../params";

export const useControllersParams = () => {
    return useQueryStates(controllersParams);
};
