import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';
import { prefs } from '@/platform/kv/kv';

/* The participant's profile picture.
 *
 * Picked from the photo library with the system picker (no camera, no storage
 * permission: Android's photo picker hands over just the one chosen image), cropped
 * square, and COPIED into the app's private document folder — the picker's own copy
 * lives in a cache the system may clear. It stays on this phone; it is not uploaded.
 * The file name is versioned per change so the image component never shows a cached
 * older picture.
 */

const key = (userId: string) => `profile.avatar.${userId}`;

interface AvatarState {
  uri: string | null;
  load(userId: string): void;
  pick(userId: string): Promise<'saved' | 'canceled'>;
  remove(userId: string): void;
}

export const useAvatar = create<AvatarState>((set, get) => ({
  uri: null,

  load(userId) {
    const saved = prefs.getString(key(userId)) ?? null;
    set({ uri: saved && new File(saved).exists ? saved : null });
  },

  async pick(userId) {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return 'canceled';
    const dest = new File(Paths.document, `avatar-${userId}-${Date.now()}.jpg`);
    new File(result.assets[0].uri).copy(dest);
    const old = get().uri;
    prefs.set(key(userId), dest.uri);
    set({ uri: dest.uri });
    if (old && old !== dest.uri) { try { new File(old).delete(); } catch { /* already gone */ } }
    return 'saved';
  },

  remove(userId) {
    const old = get().uri;
    prefs.delete(key(userId));
    set({ uri: null });
    if (old) { try { new File(old).delete(); } catch { /* already gone */ } }
  },
}));
