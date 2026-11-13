import * as ImagePicker from 'expo-image-picker';
import { ImageSourcePropType } from 'react-native';

export interface PickedMealPhoto {
  uri: string;
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
}

async function blobUriToBase64(uri: string): Promise<string> {
  if (uri.startsWith('data:')) {
    const commaIdx = uri.indexOf(',');
    return commaIdx >= 0 ? uri.slice(commaIdx + 1) : '';
  }
  const res = await fetch(uri);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = typeof reader.result === 'string' ? reader.result : '';
      const comma = str.indexOf(',');
      resolve(comma >= 0 ? str.slice(comma + 1) : str);
    };
    reader.onerror = () => reject(new Error('Failed to read selected photo.'));
    reader.readAsDataURL(blob);
  });
}

async function normalizeWebAsset(
  asset: ImagePicker.ImagePickerAsset
): Promise<PickedMealPhoto> {
  const mimeType = asset.mimeType || 'image/jpeg';
  const base64 = asset.base64 || (await blobUriToBase64(asset.uri));
  const displayUri =
    base64 && !asset.uri.startsWith('data:')
      ? `data:${mimeType};base64,${base64}`
      : asset.uri;

  return {
    uri: displayUri,
    base64,
    mimeType,
    width: asset.width,
    height: asset.height,
  };
}

export async function capturePhotoFromCamera(): Promise<PickedMealPhoto | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.72,
    base64: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  return normalizeWebAsset(result.assets[0]);
}

export async function pickPhotoFromLibrary(): Promise<PickedMealPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.72,
    base64: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  return normalizeWebAsset(result.assets[0]);
}

export async function assetToBase64(
  source: ImageSourcePropType
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    let uri = '';
    if (typeof source === 'string') {
      uri = source;
    } else if (source && typeof source === 'object' && !Array.isArray(source) && 'uri' in source) {
      uri = source.uri || '';
    }
    if (!uri) return null;

    if (uri.startsWith('data:')) {
      const comma = uri.indexOf(',');
      const meta = uri.slice(5, comma);
      const mimeType = meta.split(';')[0] || 'image/jpeg';
      return { base64: comma >= 0 ? uri.slice(comma + 1) : '', mimeType };
    }

    const res = await fetch(uri);
    const blob = await res.blob();
    const mimeType = blob.type || 'image/jpeg';
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const str = typeof reader.result === 'string' ? reader.result : '';
        const comma = str.indexOf(',');
        resolve(comma >= 0 ? str.slice(comma + 1) : str);
      };
      reader.onerror = () => reject(new Error('Failed to encode asset'));
      reader.readAsDataURL(blob);
    });
    return base64 ? { base64, mimeType } : null;
  } catch {
    return null;
  }
}

export async function persistMealPhotoUri(
  uri: string | null | undefined,
  base64Fallback?: string,
  mimeType: string = 'image/jpeg'
): Promise<string | null> {
  if (!uri) return null;
  if (uri.startsWith('data:')) return uri;
  if (base64Fallback) return `data:${mimeType};base64,${base64Fallback}`;
  return uri;
}
