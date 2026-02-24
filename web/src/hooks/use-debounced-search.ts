import { useCallback, useEffect, useState } from "react";

interface DebouncedSearchOptions {
    debounceMs?: number;
}

export const useDebouncedSearch = (
    valueFromOutside: string,
    onCommit: (value: string) => void,
    { debounceMs = 500 }: DebouncedSearchOptions = {}
) => {
    const [localValue, setLocalValue] = useState(valueFromOutside);

    useEffect(() => {
        setLocalValue(valueFromOutside);
    }, [valueFromOutside]);

    useEffect(() => {
        const trimmed = localValue.trim();

        if (trimmed === "" && valueFromOutside !== "") {
            onCommit("");
            return;
        }

        const timer = setTimeout(() => {
            if (trimmed !== valueFromOutside) {
                onCommit(trimmed);
            }
        }, debounceMs);

        return () => clearTimeout(timer);
    }, [localValue, valueFromOutside, debounceMs, onCommit]);

    const clear = useCallback(() => {
        setLocalValue("");
        onCommit("");
    }, [onCommit]);

    return {
        value: localValue,
        onChange: setLocalValue,
        clear,
    };
};
