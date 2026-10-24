import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components';

/**
 * Comments sheet: useComments(postId), useAddComment(postId), replies, likes.
 * Placeholder: replace this component, keep the file path.
 */
export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  return (
    <PlaceholderScreen
      title={'Comments'}
      route={`mobile/app/(app)/comments/[postId].tsx (postId: ${postId})`}
      icon="comment"
      note="Comments sheet: useComments(postId), useAddComment(postId), replies, likes."
    />
  );
}
