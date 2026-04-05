import { InfoCard } from './info-card'
import { InfoRow } from './info-row'

export const LocationCard = ({ latitude, longitude }: { latitude: number; longitude: number }) => (
    <InfoCard title="Location">
        <InfoRow label="Latitude" value={latitude === -1 ? 'Pending...' : latitude.toFixed(6)} />
        <InfoRow label="Longitude" value={longitude === -1 ? 'Pending...' : longitude.toFixed(6)} />
    </InfoCard>
)
