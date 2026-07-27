import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { useCallback } from 'react';

export interface PickedFile {
  file: File;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Hook to handle file picking across Web, iOS, and Android seamlessly.
 * Provides unified file selection and local caching for mobile offline ingestion.
 */
export function useNativeFilePicker() {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform(); // 'web', 'ios', or 'android'

  const pickFile = useCallback(async (accept = 'application/pdf,image/*'): Promise<PickedFile | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0] || null;
        if (!file) {
          resolve(null);
          return;
        }

        resolve({
          file,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        });
      };
      input.click();
    });
  }, []);

  /**
   * Cache file offline on native device using Capacitor Filesystem
   */
  const cacheFileOffline = useCallback(async (fileName: string, base64Data: string): Promise<string | null> => {
    if (!isNative) return null;
    try {
      const result = await Filesystem.writeFile({
        path: `cached_ingestion/${fileName}`,
        data: base64Data,
        directory: Directory.Cache,
      });
      return result.uri;
    } catch (err) {
      console.warn('[useNativeFilePicker] Failed to cache file offline:', err);
      return null;
    }
  }, [isNative]);

  return {
    isNative,
    platform,
    pickFile,
    cacheFileOffline,
  };
}
