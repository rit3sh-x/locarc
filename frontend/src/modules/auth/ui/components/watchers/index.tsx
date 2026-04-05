import { useEffect, useRef, useState } from 'react'
import { EyeBall } from './eye-ball'
import { Pupil } from './pupil'

interface WatchersProps {
    showPassword: boolean
    passwordExist: boolean
    isTyping: boolean
}

export const Watchers = ({
    showPassword,
    passwordExist,
    isTyping,
}: WatchersProps): React.JSX.Element => {
    const [mouseX, setMouseX] = useState<number>(0)
    const [mouseY, setMouseY] = useState<number>(0)
    const [isPurpleBlinking, setIsPurpleBlinking] = useState(false)
    const [isBlackBlinking, setIsBlackBlinking] = useState(false)
    const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false)
    const [isPurplePeeking, setIsPurplePeeking] = useState(false)
    const purpleRef = useRef<HTMLDivElement>(null)
    const blackRef = useRef<HTMLDivElement>(null)
    const yellowRef = useRef<HTMLDivElement>(null)
    const orangeRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            setMouseX(e.clientX)
            setMouseY(e.clientY)
        }

        window.addEventListener('mousemove', handleMouseMove)
        return () => window.removeEventListener('mousemove', handleMouseMove)
    }, [])

    useEffect(() => {
        const getRandomBlinkInterval = () => Math.random() * 4000 + 3000

        const scheduleBlink = () => {
            const blinkTimeout = setTimeout(() => {
                setIsPurpleBlinking(true)
                setTimeout(() => {
                    setIsPurpleBlinking(false)
                    scheduleBlink()
                }, 150)
            }, getRandomBlinkInterval())

            return blinkTimeout
        }

        const timeout = scheduleBlink()
        return () => clearTimeout(timeout)
    }, [])

    useEffect(() => {
        const getRandomBlinkInterval = () => Math.random() * 4000 + 3000

        const scheduleBlink = () => {
            const blinkTimeout = setTimeout(() => {
                setIsBlackBlinking(true)
                setTimeout(() => {
                    setIsBlackBlinking(false)
                    scheduleBlink()
                }, 150)
            }, getRandomBlinkInterval())

            return blinkTimeout
        }

        const timeout = scheduleBlink()
        return () => clearTimeout(timeout)
    }, [])

    useEffect(() => {
        if (isTyping) {
            setIsLookingAtEachOther(true)
            const timer = setTimeout(() => {
                setIsLookingAtEachOther(false)
            }, 800)
            return () => clearTimeout(timer)
        } else {
            setIsLookingAtEachOther(false)
        }
    }, [isTyping])

    useEffect(() => {
        if (!(passwordExist && showPassword)) {
            setIsPurplePeeking(false)
            return
        }

        let timeout: number

        const schedulePeek = () => {
            timeout = window.setTimeout(
                () => {
                    setIsPurplePeeking(true)
                    setTimeout(() => setIsPurplePeeking(false), 800)
                    schedulePeek()
                },
                Math.random() * 3000 + 2000,
            )
        }

        schedulePeek()
        return () => clearTimeout(timeout)
    }, [passwordExist, showPassword])

    const calculatePosition = (ref: React.RefObject<HTMLDivElement | null>) => {
        if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 }

        const rect = ref.current.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 3

        const deltaX = mouseX - centerX
        const deltaY = mouseY - centerY

        const faceX = Math.max(-15, Math.min(15, deltaX / 20))
        const faceY = Math.max(-10, Math.min(10, deltaY / 30))

        const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120))

        return { faceX, faceY, bodySkew }
    }

    const purplePos = calculatePosition(purpleRef)
    const blackPos = calculatePosition(blackRef)
    const yellowPos = calculatePosition(yellowRef)
    const orangePos = calculatePosition(orangeRef)

    return (
        <div className="relative flex items-end justify-center mx-auto my-auto">
            <div className="relative" style={{ width: '550px', height: '400px' }}>
                <div
                    ref={purpleRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '70px',
                        width: '180px',
                        height: isTyping || (passwordExist && !showPassword) ? '440px' : '400px',
                        backgroundColor: '#6C3FF5',
                        borderRadius: '10px 10px 0 0',
                        zIndex: 1,
                        transform:
                            passwordExist && showPassword
                                ? `skewX(0deg)`
                                : isTyping || (passwordExist && !showPassword)
                                  ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`
                                  : `skewX(${purplePos.bodySkew || 0}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-8 transition-all duration-700 ease-in-out"
                        style={{
                            left:
                                passwordExist && showPassword
                                    ? `${20}px`
                                    : isLookingAtEachOther
                                      ? `${55}px`
                                      : `${45 + purplePos.faceX}px`,
                            top:
                                passwordExist && showPassword
                                    ? `${35}px`
                                    : isLookingAtEachOther
                                      ? `${65}px`
                                      : `${40 + purplePos.faceY}px`,
                        }}
                    >
                        <EyeBall
                            size={18}
                            pupilSize={7}
                            maxDistance={5}
                            eyeColor="white"
                            pupilColor="#2D2D2D"
                            isBlinking={isPurpleBlinking}
                            forceLookX={
                                passwordExist && showPassword
                                    ? isPurplePeeking
                                        ? 4
                                        : -4
                                    : isLookingAtEachOther
                                      ? 3
                                      : undefined
                            }
                            forceLookY={
                                passwordExist && showPassword
                                    ? isPurplePeeking
                                        ? 5
                                        : -4
                                    : isLookingAtEachOther
                                      ? 4
                                      : undefined
                            }
                        />
                        <EyeBall
                            size={18}
                            pupilSize={7}
                            maxDistance={5}
                            eyeColor="white"
                            pupilColor="#2D2D2D"
                            isBlinking={isPurpleBlinking}
                            forceLookX={
                                passwordExist && showPassword
                                    ? isPurplePeeking
                                        ? 4
                                        : -4
                                    : isLookingAtEachOther
                                      ? 3
                                      : undefined
                            }
                            forceLookY={
                                passwordExist && showPassword
                                    ? isPurplePeeking
                                        ? 5
                                        : -4
                                    : isLookingAtEachOther
                                      ? 4
                                      : undefined
                            }
                        />
                    </div>
                </div>

                <div
                    ref={blackRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '240px',
                        width: '120px',
                        height: '310px',
                        backgroundColor: '#2D2D2D',
                        borderRadius: '8px 8px 0 0',
                        zIndex: 2,
                        transform:
                            passwordExist && showPassword
                                ? `skewX(0deg)`
                                : isLookingAtEachOther
                                  ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                                  : isTyping || (passwordExist && !showPassword)
                                    ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`
                                    : `skewX(${blackPos.bodySkew || 0}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-6 transition-all duration-700 ease-in-out"
                        style={{
                            left:
                                passwordExist && showPassword
                                    ? `${10}px`
                                    : isLookingAtEachOther
                                      ? `${32}px`
                                      : `${26 + blackPos.faceX}px`,
                            top:
                                passwordExist && showPassword
                                    ? `${28}px`
                                    : isLookingAtEachOther
                                      ? `${12}px`
                                      : `${32 + blackPos.faceY}px`,
                        }}
                    >
                        <EyeBall
                            size={16}
                            pupilSize={6}
                            maxDistance={4}
                            eyeColor="white"
                            pupilColor="#2D2D2D"
                            isBlinking={isBlackBlinking}
                            forceLookX={
                                passwordExist && showPassword
                                    ? -4
                                    : isLookingAtEachOther
                                      ? 0
                                      : undefined
                            }
                            forceLookY={
                                passwordExist && showPassword
                                    ? -4
                                    : isLookingAtEachOther
                                      ? -4
                                      : undefined
                            }
                        />
                        <EyeBall
                            size={16}
                            pupilSize={6}
                            maxDistance={4}
                            eyeColor="white"
                            pupilColor="#2D2D2D"
                            isBlinking={isBlackBlinking}
                            forceLookX={
                                passwordExist && showPassword
                                    ? -4
                                    : isLookingAtEachOther
                                      ? 0
                                      : undefined
                            }
                            forceLookY={
                                passwordExist && showPassword
                                    ? -4
                                    : isLookingAtEachOther
                                      ? -4
                                      : undefined
                            }
                        />
                    </div>
                </div>
                <div
                    ref={orangeRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '0px',
                        width: '240px',
                        height: '200px',
                        zIndex: 3,
                        backgroundColor: '#FF9B6B',
                        borderRadius: '120px 120px 0 0',
                        transform:
                            passwordExist && showPassword
                                ? `skewX(0deg)`
                                : `skewX(${orangePos.bodySkew || 0}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-8 transition-all duration-200 ease-out"
                        style={{
                            left:
                                passwordExist && showPassword
                                    ? `${50}px`
                                    : `${82 + (orangePos.faceX || 0)}px`,
                            top:
                                passwordExist && showPassword
                                    ? `${85}px`
                                    : `${90 + (orangePos.faceY || 0)}px`,
                        }}
                    >
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            forceLookX={passwordExist && showPassword ? -5 : undefined}
                            forceLookY={passwordExist && showPassword ? -4 : undefined}
                        />
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            forceLookX={passwordExist && showPassword ? -5 : undefined}
                            forceLookY={passwordExist && showPassword ? -4 : undefined}
                        />
                    </div>
                </div>
                <div
                    ref={yellowRef}
                    className="absolute bottom-0 transition-all duration-700 ease-in-out"
                    style={{
                        left: '310px',
                        width: '140px',
                        height: '230px',
                        backgroundColor: '#E8D754',
                        borderRadius: '70px 70px 0 0',
                        zIndex: 4,
                        transform:
                            passwordExist && showPassword
                                ? `skewX(0deg)`
                                : `skewX(${yellowPos.bodySkew || 0}deg)`,
                        transformOrigin: 'bottom center',
                    }}
                >
                    <div
                        className="absolute flex gap-6 transition-all duration-200 ease-out"
                        style={{
                            left:
                                passwordExist && showPassword
                                    ? `${20}px`
                                    : `${52 + (yellowPos.faceX || 0)}px`,
                            top:
                                passwordExist && showPassword
                                    ? `${35}px`
                                    : `${40 + (yellowPos.faceY || 0)}px`,
                        }}
                    >
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            forceLookX={passwordExist && showPassword ? -5 : undefined}
                            forceLookY={passwordExist && showPassword ? -4 : undefined}
                        />
                        <Pupil
                            size={12}
                            maxDistance={5}
                            pupilColor="#2D2D2D"
                            forceLookX={passwordExist && showPassword ? -5 : undefined}
                            forceLookY={passwordExist && showPassword ? -4 : undefined}
                        />
                    </div>
                    <div
                        className="absolute w-20 h-1 bg-[#2D2D2D] rounded-full transition-all duration-200 ease-out"
                        style={{
                            left:
                                passwordExist && showPassword
                                    ? `${10}px`
                                    : `${40 + (yellowPos.faceX || 0)}px`,
                            top:
                                passwordExist && showPassword
                                    ? `${88}px`
                                    : `${88 + (yellowPos.faceY || 0)}px`,
                        }}
                    />
                </div>
            </div>
        </div>
    )
}
