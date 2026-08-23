import { badRequest } from '../../shared/errors'
import { storage, type StoredFile } from '../../shared/storage'

export class UploadsService {
  static async saveImages(merchantId: string, files: File[]): Promise<StoredFile[]> {
    if (!files.length) throw badRequest('BAD_REQUEST', 'No files provided')
    try {
      return await Promise.all(files.slice(0, 10).map((f) => storage.save(merchantId, f)))
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed'
      throw badRequest('UPLOAD_INVALID', message)
    }
  }
}
