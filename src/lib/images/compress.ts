import { imageContentTypes, isStorableImage } from "@/lib/images/images";

/**
 * Shrink a photograph in the browser, before it costs anybody their data allowance.
 *
 * This runs on the phone that took or received the picture, and that is the only place
 * it can run: the bytes go browser-to-Storage directly, so by the time this app could
 * see a file it has already been paid for. A 4 MB iPhone photo becomes a few hundred KB
 * here, and there are no generated derivatives anywhere downstream — what is uploaded is
 * what every screen loads, forever.
 *
 * Deliberately canvas and nothing else. No dependency, no worker, no wasm: `<canvas>`
 * re-encoding is the one image API that has been in every mobile browser for a decade,
 * and the WeCom in-app webview is not a place to discover that a polyfill needs a
 * feature flag.
 *
 * **Every failure falls back to the original file.** A picture that arrives large is
 * worth more than no picture, and the 10 MB cap is still there to catch the genuinely
 * absurd. HEIC is the concrete case: Safari decodes it, most engines do not, and a
 * `createImageBitmap` that throws must not lose the photo.
 */

/** The longest edge a stored image keeps. */
const maxEdge = 1600;

/** JPEG quality. High enough to read a label in a photograph of a box. */
const quality = 0.82;

/**
 * What everything is re-encoded to: the smallest of the formats a browser can write, and
 * what almost every object in the bucket ends up being. Not *every* object — the fallback
 * below uploads the original untouched, so a HEIC nothing could decode stays HEIC.
 */
const targetType = "image/jpeg";

export async function compressImage(file: File): Promise<File> {
  try {
    const compressed = await reencode(file);

    // Re-encoding can make a file *bigger* — a small PNG screenshot of a spec sheet is
    // the usual way. Keeping the larger one would be paying for the round trip twice.
    return compressed !== null && compressed.size < file.size ? compressed : usable(file);
  } catch {
    return usable(file);
  }
}

async function reencode(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file);

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (context === null) return null;

    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, targetType, quality),
    );

    if (blob === null) return null;

    return new File([blob], `${baseName(file.name)}.jpg`, { type: targetType });
  } finally {
    // A decoded bitmap is uncompressed pixels held outside the JS heap. Five of them at
    // full phone-camera resolution is enough to have the webview killed, so they are
    // released as each picture is finished with rather than at the end of the batch.
    bitmap.close();
  }
}

/**
 * The original file, with a content type Storage will take — if there is one.
 *
 * A picker can hand over a file with an empty or unrecognised `type`: the same photo,
 * described by a webview that did not want to commit. The extension is then the only
 * other evidence there is, and on the fallback path it is usually `.HEIC` off an iPhone.
 *
 * An unrecognised extension is left with the type it came with rather than guessed into
 * an image. Guessing here would be the one way a non-image reaches the bucket — a PDF
 * fails to decode, lands on this path, and would be relabelled as a photograph. Refusing
 * it is the server's job, and it can only do that job if nobody has lied to it first.
 */
function usable(file: File): File {
  if (isStorableImage(file.type)) return file;

  const guessed = fromExtension(file.name);

  return guessed === null ? file : new File([file], file.name, { type: guessed });
}

function fromExtension(name: string): string | null {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();

  for (const [contentType, known] of imageContentTypes) {
    if (known === extension) return contentType;
  }

  // `.jpeg` is the same picture as `.jpg` and is what a desktop mail client saves.
  if (extension === "jpeg") return targetType;

  return null;
}

function baseName(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(0, dot) : name;
}
