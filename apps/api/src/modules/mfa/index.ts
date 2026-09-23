import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { MfaService } from './service'
import {
  mfaBackupCodesResponse,
  mfaCodeBody,
  mfaDisableResponse,
  mfaEnableResponse,
  mfaRevokeResponse,
  mfaSessionListResponse,
  mfaSetupResponse,
  mfaStatusResponse,
  sessionIdParams
} from './model'

export const mfaModule = new Elysia({ prefix: '/api/mfa' })
  .use(authPlugin)
  .get('/status', async ({ auth }) => MfaService.status(auth.user.id), {
    response: mfaStatusResponse
  })
  .post('/setup', async ({ auth }) => MfaService.startSetup(auth.user.id), {
    response: mfaSetupResponse
  })
  .post('/enable', async ({ auth, body }) => MfaService.confirmSetup(auth.user.id, body.code), {
    body: mfaCodeBody,
    response: mfaEnableResponse
  })
  .post('/disable', async ({ auth, body }) => MfaService.disable(auth.user.id, body.code), {
    body: mfaCodeBody,
    response: mfaDisableResponse
  })
  .post(
    '/backup-codes/regenerate',
    async ({ auth, body }) => MfaService.regenerateBackupCodes(auth.user.id, body.code),
    { body: mfaCodeBody, response: mfaBackupCodesResponse }
  )
  .get('/sessions', async ({ auth }) => MfaService.listSessions(auth.user.id, auth.merchant.id), {
    response: mfaSessionListResponse
  })
  .delete(
    '/sessions/:id',
    async ({ auth, params }) => MfaService.revokeSession(auth.user.id, auth.merchant.id, params.id),
    { params: sessionIdParams, response: mfaRevokeResponse }
  )
