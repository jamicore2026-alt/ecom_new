export class HttpError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (code: string, message: string) =>
  new HttpError(400, code, message)
export const unauthorized = (message = 'Please sign in to continue') =>
  new HttpError(401, 'UNAUTHORIZED', message)
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, 'FORBIDDEN', message)
export const notFound = (code: string, message: string) =>
  new HttpError(404, code, message)
export const conflict = (code: string, message: string) =>
  new HttpError(409, code, message)
