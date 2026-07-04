import { ActivityIndicator, Pressable, Text } from "react-native";

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/** VIEW — the app's primary CTA button with loading/disabled states. */
export function PrimaryButton({ title, onPress, loading, disabled }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      className={`custom-btn ${inactive ? "opacity-50" : ""}`}
    >
      {loading ? (
        <ActivityIndicator color="white" />
      ) : (
        <Text className="font-quicksand-bold text-base text-white">
          {title}
        </Text>
      )}
    </Pressable>
  );
}
