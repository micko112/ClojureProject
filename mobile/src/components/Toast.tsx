import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, radii } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface ToastOptions {
  icon?: IconName;
  /** e.g. { label: 'View', onPress } */
  action?: { label: string; onPress: () => void };
  /** ms, default 2800 */
  duration?: number;
  /** distance from the bottom safe area; default clears the tab bar */
  offset?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

type Show = (message: string, opts?: ToastOptions) => void;

const ToastContext = createContext<Show | null>(null);
let globalShow: Show | null = null;

/**
 * Imperative toast for non-React code (mutations, api helpers):
 *   toast('Saved');  toast("Couldn't like post", { icon: 'alert' });
 */
export function toast(message: string, opts?: ToastOptions): void {
  globalShow?.(message, opts);
}

/** Hook form: `const show = useToast(); show('Link copied')` */
export function useToast(): Show {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();

  const show = useCallback<Show>((message, opts) => {
    if (timer.current) clearTimeout(timer.current);
    const item = { id: ++seq.current, message, ...opts };
    setCurrent(item);
    timer.current = setTimeout(() => setCurrent((c) => (c?.id === item.id ? null : c)), opts?.duration ?? 2800);
  }, []);

  useEffect(() => {
    globalShow = show;
    return () => {
      if (globalShow === show) globalShow = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {current ? (
          <Animated.View
            key={current.id}
            entering={FadeInDown.duration(200)}
            exiting={FadeOutDown.duration(180)}
            style={[styles.toast, { bottom: insets.bottom + (current.offset ?? layout.tabBarHeight + 12) }]}
          >
            {current.icon ? <Icon name={current.icon} size={20} color={colors.text} /> : null}
            <Text variant="body" style={styles.message} numberOfLines={2}>
              {current.message}
            </Text>
            {current.action ? (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  current.action?.onPress();
                  setCurrent(null);
                }}
              >
                <Text variant="bodyStrong" tone="accent">
                  {current.action.label}
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 12,
    right: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.fill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  message: { flex: 1 },
});
