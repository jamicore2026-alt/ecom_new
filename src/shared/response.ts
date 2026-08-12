export type ErrBody = { success: false; error: { code: string; message: string } }
export type OkBody<T> = { success: true; data: T }

export const err = (code: string, message: string): ErrBody => ({
  success: false,
  error: { code, message }
})

export const ok = <T>(data: T): OkBody<T> => ({ success: true, data })
