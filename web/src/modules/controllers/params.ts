import { parseAsString } from "nuqs/server";

export const controllersParams = {
    search: parseAsString
        .withOptions({
            clearOnDefault: true,
        })
        .withDefault(""),
};
