import { parseAsString } from 'nuqs'

export const controllersParams = {
    search: parseAsString
        .withOptions({
            clearOnDefault: true,
        })
        .withDefault(''),
}
