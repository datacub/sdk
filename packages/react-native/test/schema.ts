import { z } from 'zod'

// The batch shape the ingestion service accepts from an app, written out here so the suites check
// every request the SDK makes. Shape only: the server repeats the privacy rules on the values.

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const uuid7 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const id = z.string().min(1).max(128)
const short = (max: number) => z.string().max(max)

const reservedEvents = ['$screen', '$identify', '$set', '$consent']

const appContext = z.strictObject({
  screen: short(200).optional(),
  locale: short(35),
  platform: z.enum(['ios', 'android']),
  os_version: short(32),
  device_class: z.enum(['mobile', 'tablet']),
  app_version: short(64).nullable(),
  app_build: short(64).nullable(),
})

const appEvent = z.strictObject({
  uuid: uuid7,
  event: z
    .string()
    .min(1)
    .max(400)
    .refine((e) => !e.startsWith('$') || reservedEvents.includes(e), 'reserved_event_name'),
  ts: z.iso.datetime(),
  anon_id: uuid,
  user_id: id.nullable(),
  account_id: id.nullable(),
  session_id: uuid7,
  page_id: uuid7.nullable(),
  seq: z.number().int().min(0).max(4294967295),
  consent_state: z.enum(['granted', 'not_required']),
  persistence: z.enum(['storage', 'memory']),
  context: appContext,
  properties: z
    .record(z.string(), z.unknown())
    .refine((p) => Object.keys(p).length <= 201, 'too_many_properties'),
})

export const appBatch = z.strictObject({
  api_key: z.string().regex(/^pk_(?:live|test)_[A-Za-z0-9]{24,48}$/),
  sent_at: z.iso.datetime(),
  lib: z.strictObject({
    name: z.literal('@datacub/react-native'),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/),
  }),
  app_id: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,155}$/)
    .optional(),
  events: z.array(appEvent).min(1).max(100),
  dropped: z.number().int().positive().optional(),
})
