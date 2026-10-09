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
