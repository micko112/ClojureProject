import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { colors } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /**
   * Safe-area edges to pad. Default ['top'] — tab screens sit above the tab
   * bar (which handles the bottom inset); full-screen stacks pass ['top','bottom'].
   */
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  /** Background, default black. */
  background?: string;
}

/** Root view of every screen: black background + safe-area padding. */
export function Screen({ children, edges = ['top'], style, background = colors.bg }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: background,
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
          paddingLeft: edges.includes('left') ? insets.left : 0,
          paddingRight: edges.includes('right') ? insets.right : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
