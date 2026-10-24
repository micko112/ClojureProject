import { PlaceholderScreen } from '@/components';

/**
 * Composer step 1: pick up to 10 photos/videos (expo-image-picker), crop,
 * reorder, choose single / carousel / compare (Before/After). Upload each with
 * uploadMedia() from '@/api/upload' (progress + abort), then go to ./details.
 * `?mode=story` comes from the stories bar ("Your story").
 * Placeholder: replace this component, keep the file path.
 */
export default function CreatePickScreen() {
  return (
    <PlaceholderScreen
      title="New post"
      route="mobile/app/(app)/create/index.tsx"
      icon="images"
      note="Pick photos or videos of today's progress."
    />
  );
}
