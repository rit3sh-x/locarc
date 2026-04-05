import React, { useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

type WWavePathProps = React.ComponentProps<'div'>

export function WavePath({ className, ...props }: WWavePathProps): React.JSX.Element {
    const pathRef = useRef<SVGPathElement>(null)

    const progress = useRef(0)
    const x = useRef(0.2)
    const time = useRef(Math.PI / 2)
    const reqId = useRef<number | null>(null)

    const setPath = useCallback((currentProgress: number) => {
        const width = window.innerWidth * 0.7
        if (pathRef.current) {
            pathRef.current.setAttributeNS(
                null,
                'd',
                `M0 100 Q${width * x.current} ${100 + currentProgress * 0.6}, ${width} 100`,
            )
        }
    }, [])

    const lerp = (start: number, end: number, a: number) => start * (1 - a) + end * a

    const resetAnimation = useCallback(() => {
        time.current = Math.PI / 2
        progress.current = 0
    }, [])

    function animateOut() {
        const newProgress = progress.current * Math.sin(time.current)
        progress.current = lerp(progress.current, 0, 0.025)
        time.current += 0.2

        setPath(newProgress)

        if (Math.abs(progress.current) > 0.1) {
            reqId.current = requestAnimationFrame(animateOut)
        } else {
            resetAnimation()
        }
    }

    useEffect(() => {
        setPath(progress.current)
        return () => {
            if (reqId.current) cancelAnimationFrame(reqId.current)
        }
    }, [setPath])

    const manageMouseEnter = () => {
        if (reqId.current) {
            cancelAnimationFrame(reqId.current)
            resetAnimation()
        }
    }

    const manageMouseMove = (e: React.MouseEvent) => {
        const { movementY, clientX } = e
        if (pathRef.current) {
            const pathBound = pathRef.current.getBoundingClientRect()
            x.current = (clientX - pathBound.left) / pathBound.width
            progress.current += movementY
            setPath(progress.current)
        }
    }

    const manageMouseLeave = () => {
        animateOut()
    }

    return (
        <div className={cn('relative h-px w-[70vw]', className)} {...props}>
            <div
                onMouseEnter={manageMouseEnter}
                onMouseMove={manageMouseMove}
                onMouseLeave={manageMouseLeave}
                className="relative -top-5 z-10 h-10 w-full hover:-top-37.5 hover:h-75 cursor-pointer"
            />
            <svg className="absolute -top-25 h-75 w-full pointer-events-none">
                <path ref={pathRef} className="fill-none stroke-current" strokeWidth={2} />
            </svg>
        </div>
    )
}
