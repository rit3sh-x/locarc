import L from "leaflet";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const baseOptions: Omit<L.IconOptions, "iconUrl"> = {
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],

    shadowUrl: markerShadow.src,
    shadowSize: [41, 41],
    shadowAnchor: [12, 41],
};

export const locationIcon = new L.Icon({
    ...baseOptions,
    iconUrl: "/pin/red.png",
});

export const controllerIcon = new L.Icon({
    ...baseOptions,
    iconUrl: "/pin/black.png",
});
