import { Suspense } from 'react'
import { ControllerInfo, ControllerInfoSkeleton } from '../components/controller-info'

export const UserView = () => {
    return (
        <div className="flex flex-col bg-background w-full h-full max-w-3xl gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6 overflow-y-auto">
            <Suspense fallback={<ControllerInfoSkeleton />}>
                <ControllerInfo />
            </Suspense>
        </div>
    )
}
