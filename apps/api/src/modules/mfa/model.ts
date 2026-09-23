import { t } from 'elysia'

export const mfaStatusResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    enabled: t.Boolean(),
    backupCodesRemaining: t.Number()
  })
})

export const mfaSetupResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    secret: t.String(),
    otpauthUrl: t.String()
  })
})

export const mfaCodeBody = t.Object({
  code: t.String({ minLength: 6, maxLength: 12 })
})

export const mfaEnableResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    enabled: t.Boolean(),
    backupCodes: t.Array(t.String())
  })
})

export const mfaDisableResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    enabled: t.Boolean()
  })
})

export const mfaBackupCodesResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    backupCodes: t.Array(t.String())
  })
})

export const mfaSession = t.Object({
  id: t.String(),
  ip: t.Union([t.String(), t.Null()]),
  userAgent: t.Union([t.String(), t.Null()]),
  lastSeenAt: t.Unknown(),
  expiresAt: t.Unknown(),
  revokedAt: t.Union([t.Unknown(), t.Null()]),
  createdAt: t.Unknown(),
  active: t.Boolean(),
  current: t.Boolean()
})

export const mfaSessionListResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    sessions: t.Array(mfaSession)
  })
})

export const mfaRevokeResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    revoked: t.Boolean(),
    current: t.Boolean()
  })
})

export const sessionIdParams = t.Object({
  id: t.String()
})
