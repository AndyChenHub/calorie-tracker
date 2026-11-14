import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Image, ImageSourcePropType, Platform } from 'react-native';
import { stripImageMetadataBase64 } from '../utils/imagePrivacy';

export interface PickedMealPhoto {
  uri: string;
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export async function capturePhotoFromCamera(): Promise<PickedMealPhoto | null> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new Error(
        'Camera permission is required to take meal photos. Please enable it in iOS Settings.'
      );
    }
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.72,
    base64: true,
    exif: false,
    allowsEditing: false,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  return normalizeAsset(result.assets[0]);
}

export async function pickPhotoFromLibrary(): Promise<PickedMealPhoto | null> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new Error(
        'Photo library permission is required to choose meal photos. Please enable it in iOS Settings.'
      );
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.72,
    base64: true,
    exif: false,
    allowsEditing: false,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  return normalizeAsset(result.assets[0]);
}

async function normalizeAsset(
  asset: ImagePicker.ImagePickerAsset
): Promise<PickedMealPhoto> {
  const mimeType = asset.mimeType || 'image/jpeg';
  let base64 = asset.base64 || '';

  if (!base64 && asset.uri) {
    if (asset.uri.startsWith('data:')) {
      const commaIdx = asset.uri.indexOf(',');
      base64 = commaIdx >= 0 ? asset.uri.slice(commaIdx + 1) : '';
    } else if (Platform.OS !== 'web') {
      const file = new File(asset.uri);
      base64 = await file.base64();
    }
  }

  if (base64) {
    base64 = stripImageMetadataBase64(base64);
  }

  const displayUri =
    Platform.OS === 'web' && base64 && !asset.uri.startsWith('data:')
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

export async function assetToBase64(
  source: ImageSourcePropType
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    let uri = '';
    if (typeof source === 'number') {
      uri = Image.resolveAssetSource(source)?.uri || '';
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

    if (uri.startsWith('file://')) {
      const file = new File(uri);
      const b64 = await file.base64();
      return { base64: b64, mimeType: 'image/jpeg' };
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

  if (Platform.OS === 'web') {
    if (uri.startsWith('data:')) return uri;
    if (base64Fallback) return `data:${mimeType};base64,${base64Fallback}`;
    return uri;
  }

  try {
    const photosDir = new Directory(Paths.document, 'meal-photos');
    if (!photosDir.exists) {
      photosDir.create({ intermediates: true, idempotent: true });
    }

    if (uri.includes('meal-photos/')) {
      return uri;
    }

    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const destFile = new File(
      photosDir,
      `meal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
    );
    const srcFile = new File(uri);
    await srcFile.copy(destFile);
    return destFile.uri;
  } catch {
    return uri;
  }
}
