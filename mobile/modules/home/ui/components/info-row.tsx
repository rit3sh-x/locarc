import { View } from 'react-native'
import { Text } from '@/components/ui/text'

export const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <View className="flex-row justify-between items-center py-2">
        <Text className="text-muted-foreground text-sm">{label}</Text>
        <Text className="text-sm font-medium">{value}</Text>
    </View>
)
