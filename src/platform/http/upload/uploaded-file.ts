/**
 * The shape multer hands a controller, narrowed to what a use case may read.
 *
 * Declared here rather than taken from `Express.Multer.File` so that swapping
 * the multipart parser — or calling a use case from a queue consumer with no
 * HTTP request at all — does not change a single application signature.
 */
export interface UploadedFileLike {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}
