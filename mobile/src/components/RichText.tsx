import { router } from 'expo-router';
import { Fragment } from 'react';

import { Text } from './Text';

type Segment = { kind: 'text' | 'tag' | 'mention'; value: string };

const TOKEN = /([#@][\p{L}\p{N}_.]+)/gu;

/** Splits text into plain / #hashtag / @mention segments (same rules as the backend). */
export function parseRichText(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    const raw = m[0];
    // "@name." at a sentence end: drop trailing dots
    const token = raw.replace(/\.+$/, '');
    if (i > last) out.push({ kind: 'text', value: text.slice(last, i) });
    out.push({ kind: raw.startsWith('#') ? 'tag' : 'mention', value: token });
    if (token.length < raw.length) out.push({ kind: 'text', value: raw.slice(token.length) });
    last = i + raw.length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/**
 * Inline segments for use inside a <Text>: hashtags open hashtag/[tag],
 * mentions open profile/[username]. Render inside your own <Text>.
 */
export function RichTextSpans({ text }: { text: string }) {
  return (
    <>
      {parseRichText(text).map((s, i) =>
        s.kind === 'text' ? (
          <Fragment key={i}>{s.value}</Fragment>
        ) : (
          <Text
            key={i}
            tone="link"
            suppressHighlighting={false}
            onPress={() =>
              s.kind === 'tag'
                ? router.push({ pathname: '/hashtag/[tag]', params: { tag: s.value.slice(1) } })
                : router.push({ pathname: '/profile/[username]', params: { username: s.value.slice(1) } })
            }
          >
            {s.value}
          </Text>
        ),
      )}
    </>
  );
}
