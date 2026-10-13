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
