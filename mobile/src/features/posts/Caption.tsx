import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

import { Text } from '@/components';
import { RichTextSpans } from '@/components/RichText';

export interface CaptionProps {
  username: string;
  text: string;
  /** collapsed line count (default 2) */
  lines?: number;
}

const MORE = '… more';

/**
 * "username caption… more" — bold username, tappable hashtags/mentions,
 * collapses to `lines` lines with an inline grey "more".
 */
export function Caption({ username, text, lines = 2 }: CaptionProps) {
  const [expanded, setExpanded] = useState(false);
  // number of caption characters that fit in `lines` lines, null until measured
  const [fit, setFit] = useState<number | null>(Platform.OS === 'web' ? webFit(text) : null);

  const onMeasure = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    const l = e.nativeEvent.lines;
    if (l.length <= lines) {
      setFit(Infinity);
      return;
    }
    const chars = l.slice(0, lines).reduce((n, line) => n + line.text.length, 0);
    // remove "username " prefix and leave room for "… more"
    setFit(Math.max(0, chars - username.length - 1 - MORE.length - 3));
  };

  const truncated = !expanded && fit !== null && fit !== Infinity && fit < text.length;
  const shown = truncated ? text.slice(0, fit ?? 0).replace(/\s+\S*$/, '') : text;

  return (
    <View>
      {fit === null ? (
        // invisible full-width measurement pass
        <Text variant="body" style={styles.measure} onTextLayout={onMeasure} accessible={false}>
          <Text variant="bodyStrong">{username}</Text> {text}
        </Text>
      ) : null}
      <Text variant="body" numberOfLines={expanded ? undefined : lines}>
        <Text
          variant="bodyStrong"
          onPress={() => router.push({ pathname: '/profile/[username]', params: { username } })}
        >
          {username}
        </Text>{' '}
        <RichTextSpans text={shown} />
        {truncated ? (
          <Text variant="body" tone="secondary" onPress={() => setExpanded(true)}>
            {MORE}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}

/** Web has no onTextLayout lines: approximate by characters (~2 lines at 390px). */
function webFit(text: string): number {
  const approx = 80;
  return text.length > approx ? approx : Infinity;
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', opacity: 0, left: 0, right: 0 },
});
