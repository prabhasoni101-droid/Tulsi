import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../services/firebase';

/** Upload a data-URL or File image to Firebase Storage; returns HTTPS download URL. */
export async function uploadEventImage(
  templeId: string,
  fileOrDataUrl: File | string,
  eventId?: string
): Promise<string> {
  const id = eventId || crypto.randomUUID();
  const storageRef = ref(storage, `temples/${templeId}/events/${id}/cover.jpg`);

  let blob: Blob;
  if (typeof fileOrDataUrl === 'string') {
    const res = await fetch(fileOrDataUrl);
    blob = await res.blob();
  } else {
    blob = fileOrDataUrl;
  }

  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}
