import { Pressable, Text } from "react-native";

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

/**
 * VIEW — pill-shaped toggle (section selectors, delivery slots, category
 * pickers). The label sets only a font size, never a fixed line height:
 * `text-sm` pins lineHeight to 20px, and on Android with a larger system
 * font size Quicksand's descenders overflow it and get clipped.
 */
export function Chip({ label, active, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={active ? "chip-active" : "chip"}
    >
      <Text
        className={`font-quicksand-semibold text-[14px] ${active ? "text-white" : "text-dark-100"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
