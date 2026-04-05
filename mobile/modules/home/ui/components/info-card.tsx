import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export const InfoCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card className="mb-4">
        <CardHeader>
            <CardTitle>{title}</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent>{children}</CardContent>
    </Card>
)
