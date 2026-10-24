import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts, hairline, radii } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  /** Shown as placeholder, then as a small floating label once there is text. */
  label: string;
  error?: string | null;
  /** Adds an eye toggle for passwords. */
  secureToggle?: boolean;
}

/**
 * Instagram auth-style input: #121212 fill, #363636 border, floating label.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, secureToggle, secureTextEntry, value, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const floating = !!value;

  return (
    <View style={style}>
      <View
        style={[
          styles.box,
          focused && { borderColor: colors.textTertiary },
          !!error && { borderColor: colors.danger },
        ]}
      >
        {floating ? (
          <Text variant="caption" tone="secondary" style={styles.floatLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          value={value}
          placeholder={label}
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          keyboardAppearance="dark"
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          style={[styles.input, floating && styles.inputFloating]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          accessibilityLabel={label}
          {...rest}
        />
        {secureToggle && value ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} style={styles.eye} accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: hairline * 2,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  floatLabel: { position: 'absolute', top: 8, left: 14, right: 40, fontSize: 11, lineHeight: 13 },
  input: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.system,
    paddingVertical: 0,
    paddingRight: 30,
    height: 54,
  },
  inputFloating: { paddingTop: 14 },
  eye: { position: 'absolute', right: 14, top: 18 },
  error: { marginTop: 6, marginLeft: 4 },
});
