import { router, Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMe } from '@/api/hooks/account';
import { Avatar, CreateIcon, Icon } from '@/components';
import { colors, hairline, layout } from '@/theme';

/**
 * Instagram bottom bar: Home / Search / Create / Reels / Profile.
 * Icons only, outline when inactive and filled when active; profile shows
 * your avatar with a white ring when selected. "Create" opens the
 * full-screen composer instead of switching tabs.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { data: me } = useMe();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.separator,
          borderTopWidth: hairline,
          height: layout.tabBarHeight + insets.bottom,
          paddingTop: 4,
          elevation: 0,
        },
        tabBarItemStyle: { paddingTop: 2 },
        sceneStyle: { backgroundColor: colors.bg },
        animation: 'none',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: ({ focused, color }) => <Icon name="home" active={focused} size={27} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarAccessibilityLabel: 'Search and explore',
          tabBarIcon: ({ focused, color }) => <Icon name="search" active={focused} size={27} color={color} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarAccessibilityLabel: 'Create a post',
          tabBarIcon: ({ color }) => <CreateIcon size={27} color={color} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/create');
          },
        }}
      />
      <Tabs.Screen
        name="reels"
        options={{
          title: 'Reels',
          tabBarAccessibilityLabel: 'Reels',
          tabBarIcon: ({ focused, color }) => <Icon name="reels" active={focused} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Your profile',
          tabBarIcon: ({ focused }) => (
            <View style={[styles.avatarRing, focused && styles.avatarRingActive]}>
              <Avatar uri={me?.profilePic} size={26} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  avatarRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.transparent,
  },
  avatarRingActive: { borderColor: colors.text },
});
