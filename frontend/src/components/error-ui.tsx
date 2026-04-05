import { WavePath } from './wave-path'
import { cn } from '@/lib/utils'

export const ErrorUI = () => {
    return (
        <div className="relative w-full flex min-h-screen flex-col items-center justify-center">
            <div
                aria-hidden="true"
                className={cn(
                    'pointer-events-none absolute -top-10 left-1/2 size-full -translate-x-1/2 rounded-full',
                    'bg-[radial-gradient(ellipse_at_center,--theme(--color-foreground/.1),transparent_50%)]',
                    'blur-[30px]',
                )}
            />

            <div className="flex w-[70vw] flex-col items-end">
                <WavePath className="mb-10" />

                <div className="flex w-full flex-col items-end">
                    <p className="text-3xl md:text-4xl font-semibold tracking-tight">
                        Unknown Error Occurred
                    </p>
                </div>
            </div>
        </div>
    )
}
