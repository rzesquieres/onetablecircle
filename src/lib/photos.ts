"use client";

import { getSupabase } from "./supabase/client";

const BUCKET = "menu-photos";

/** Shrink a photo (e.g. 12 MP from a phone camera) to a small JPEG before uploading. */
export async function resizeImage(file: File, maxSize = 1000, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that photo.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't process that photo.");
  return blob;
}

/** Upload a menu photo into the store's folder; returns the storage path to save on the item. */
export async function uploadMenuPhoto(storeId: string, itemId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo (JPG, PNG or WebP).");
  const blob = await resizeImage(file);
  const path = `${storeId}/${itemId}-${Date.now()}.jpg`;
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function deleteMenuPhoto(path: string | null): Promise<void> {
  if (!path) return;
  await getSupabase().storage.from(BUCKET).remove([path]);
}
