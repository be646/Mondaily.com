/**
 * Client-side image downscaling for avatars/logos. An avatar only ever renders at ~40px, so we
 * center-crop to a square and scale down to a small thumbnail BEFORE encoding — turning a ~2 MB
 * upload into a ~5–15 KB data URL. This matters because avatar_url is stored on workspace_members
 * and selected by member-LIST queries (activities, members, inbox, calls); a full-size data URL
 * would drag megabytes of base64 per member across every list response. Runs entirely in the
 * browser (canvas) — no upload endpoint, no storage bucket, and the result is still a plain data
 * URL so existing avatars and every <img src> render unchanged.
 */
export async function downscaleImageToDataUrl(
  file: File,
  opts: { max?: number; quality?: number } = {},
): Promise<string> {
  const max = opts.max ?? 128;
  const quality = opts.quality ?? 0.85;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image."));
      el.src = objectUrl;
    });

    // Center-crop to a square using the smaller dimension, then scale to `max`.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = Math.round((img.naturalWidth - side) / 2);
    const sy = Math.round((img.naturalHeight - side) / 2);
    const target = Math.min(max, side || max);

    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // No canvas → fall back to the raw file as a data URL (still capped by the caller's size check).
      return await fileToDataUrl(file);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);

    // Preserve transparency for PNGs; JPEG is smaller for photos.
    const isPng = file.type === "image/png";
    return canvas.toDataURL(isPng ? "image/png" : "image/jpeg", quality);
  } catch {
    // Any decode failure → fall back to the original file, so upload never silently no-ops.
    return await fileToDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
