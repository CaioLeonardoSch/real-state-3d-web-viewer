/**
 * Photos chosen in the "Anunciar" form are shrunk in the browser (JPEG, longest side `max` px) before being
 * kept in localStorage, which holds only a few MB. With a back end they would go to object storage instead.
 */
export async function resizeImage(file: File, max = 960, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

/** Small version of a photo for lists and the gallery strip (~320 px, a few KB). */
export const makeThumb = (file: File) => resizeImage(file, 320, 0.7);

/**
 * Longest side (px) and JPEG quality of the three versions of a photo sent to the back end: `thumb` for cards and
 * strips, `src` for phones and panels, `large` for the gallery on big or high-density screens. Kept in the browser
 * only (no back end), photos stay at 960/320 px: localStorage holds only a few MB.
 */
export const PHOTO_SIZES = { thumb: [480, 0.72], src: [1024, 0.78], large: [1920, 0.8] } as const;

/** The three versions of a photo, decoded once. `large` only when the photo is bigger than `src`. */
export async function photoVersions(file: File): Promise<{ src: string; thumb: string; large?: string }> {
  const bitmap = await createImageBitmap(file);
  const draw = ([max, quality]: readonly [number, number]) => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };
  const out = {
    src: draw(PHOTO_SIZES.src),
    thumb: draw(PHOTO_SIZES.thumb),
    ...(Math.max(bitmap.width, bitmap.height) > PHOTO_SIZES.src[0] ? { large: draw(PHOTO_SIZES.large) } : {}),
  };
  bitmap.close();
  return out;
}

/**
 * Candidates of a photo stored in the three sizes, for `srcset` (by the longest side: a portrait photo is narrower,
 * and the browser then picks a size up, never a blurry one). Photos from before, or from elsewhere, have none.
 * `upTo: 'src'` leaves out the large version (cards and phones).
 */
export function photoSrcset(p: { src: string; thumb?: string; large?: string }, upTo: 'src' | 'large' = 'large'): string | null {
  if (!p.large || !p.thumb) return null;
  const set = [`${p.thumb} ${PHOTO_SIZES.thumb[0]}w`, `${p.src} ${PHOTO_SIZES.src[0]}w`];
  if (upTo === 'large') set.push(`${p.large} ${PHOTO_SIZES.large[0]}w`);
  return set.join(', ');
}

/**
 * Logo or banner of a client's site: any image (SVG included) drawn on a canvas, longest side `max` px. Logos stay
 * PNG (transparency); photos become JPEG. SVG files are never stored as such (they may carry scripts).
 */
export function siteImage(file: File, max: number, kind: 'png' | 'jpeg'): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 600;
      const h = img.naturalHeight || 200;
      const scale = Math.min(1, max / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL(`image/${kind}`, 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}
