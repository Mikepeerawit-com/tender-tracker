/**
 * A one-pixel JPEG, for tests that need a body Storage will actually accept.
 *
 * A `Blob` of text will not do: the `images` bucket restricts `allowed_mime_types`, so a
 * round trip through a signed upload URL is the only thing that proves the measured
 * compress-and-upload path still gets through — and that means sending something that is
 * genuinely a JPEG.
 *
 * A module rather than a copy in each test file, on the same argument as
 * `src/lib/wecom/robot-stub.ts`: two identical base64 blobs drift, and this one is now
 * used by both the storage-policy tests and the Reference Image tests.
 */
const onePixel =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB" +
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/8AAEQgAAQABAwERAAIR" +
  "AQMRAf/EABQAAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QA" +
  "FAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhED" +
  "EQA/AJgA/9k=";

export function onePixelJpeg(): Blob {
  return new Blob(
    [Uint8Array.from(atob(onePixel), (character) => character.charCodeAt(0))],
    { type: "image/jpeg" },
  );
}
