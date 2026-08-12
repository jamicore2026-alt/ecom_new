import { HttpError } from '../shared/errors'
import { err } from '../shared/response'

type ErrorContext = {
  code: number | string
  error: unknown
  set: { status?: number | string }
}

export const errorHandler = ({ code, error, set }: ErrorContext) => {
  if (error instanceof HttpError) {
    set.status = error.httpStatus
    return err(error.code, error.message)
  }

  if (code === 'VALIDATION') {
    set.status = 400
    const detail = (error as { all?: Array<{ path: string; message: string }> | null })
      ?.all
      ?.map((e) => ({ path: e.path, message: e.message }))
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        ...(detail && detail.length ? { fields: detail } : {})
      }
    }
  }

  if (code === 'PARSE') {
    set.status = 400
    return err('BAD_REQUEST', 'Could not parse request body')
  }

  if (code === 'NOT_FOUND') {
    set.status = 404
    return err('NOT_FOUND', 'Route not found')
  }

  console.error('[error]', error)
  set.status = 500
  return err('INTERNAL_ERROR', 'Something went wrong')
}
