"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useCurrentTheme } from "@/hooks/use-current-theme";

export const TileController = () => {
    const map = useMap();
    const theme = useCurrentTheme();
    const lightRef = useRef<L.TileLayer | null>(null);
    const darkRef = useRef<L.TileLayer | null>(null);

    useEffect(() => {
        lightRef.current = L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            { crossOrigin: true }
        );
        darkRef.current = L.tileLayer(
            "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            { crossOrigin: true }
        );

        return () => {
            lightRef.current?.remove();
            darkRef.current?.remove();
        };
    }, [map]);

    useEffect(() => {
        if (!lightRef.current || !darkRef.current) return;
        if (theme === "dark") {
            if (map.hasLayer(lightRef.current))
                map.removeLayer(lightRef.current);
            if (!map.hasLayer(darkRef.current)) darkRef.current.addTo(map);
        } else {
            if (map.hasLayer(darkRef.current)) map.removeLayer(darkRef.current);
            if (!map.hasLayer(lightRef.current)) lightRef.current.addTo(map);
        }
    }, [theme, map]);

    return null;
};
