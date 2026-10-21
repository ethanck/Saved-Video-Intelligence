import { useLocalSearchParams } from "expo-router";
import { CaptureDetailScreen } from "../../src/CaptureDetailScreen";

/** Dynamic route for one user-owned capture and its processing history. */
export default function CaptureDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CaptureDetailScreen captureId={id} />;
}
