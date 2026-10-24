import { PlaceholderScreen } from '@/components';

/**
 * Never shown: the tab press opens /create (see (tabs)/_layout.tsx).
 * Placeholder: replace this component, keep the file path.
 */
export default function CreateTab() {
  return (
    <PlaceholderScreen
      title="Create"
      route="mobile/app/(app)/(tabs)/create.tsx"
      icon="add"
      note="Never shown: the tab press opens /create (see (tabs)/_layout.tsx)."
    />
  );
}
