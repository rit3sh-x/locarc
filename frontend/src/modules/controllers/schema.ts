import { z } from 'zod'

export const editControllerSchema = z.object({
    name: z.string().min(3, 'Name must be at least 3 characters'),
    username: z
        .string()
        .refine((v) => v === '' || v.length >= 3, 'Username must be at least 3 characters'),
    password: z
        .string()
        .refine((v) => v === '' || v.length >= 8, 'Password must be at least 8 characters'),
    settings: z.object({
        lnaGainDb: z.number(),
        vgaGainDb: z.number().min(0).max(62),
        bufferSizeKb: z.number().positive(),
        powerCalOffsetDbOverride: z.union([z.number(), z.undefined()]),
    }),
})

export const addControllerSchema = z.object({
    name: z.string().min(3, 'Name must be at least 3 characters'),
    username: z.string().min(3, 'Username must be at least 3 characters'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    settings: z.object({
        lnaGainDb: z.number(),
        vgaGainDb: z.number().min(0).max(62),
        bufferSizeKb: z.number().positive(),
    }),
})
