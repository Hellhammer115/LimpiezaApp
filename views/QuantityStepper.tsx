import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { useCart } from "@/controllers/useCart";

interface Props {
  productId: string;
  compact?: boolean;
}

/** VIEW — +/− quantity control bound to one cart line. */
export function QuantityStepper({ productId, compact }: Props) {
  const quantity = useCart(
    (s) => s.items.find((i) => i.productId === productId)?.quantity ?? 0
  );
  const increment = useCart((s) => s.increment);
  const decrement = useCart((s) => s.decrement);

  const buttonSize = compact ? "size-7" : "size-9";
  const iconSize = compact ? 14 : 18;

  return (
    <View className="flex-row items-center gap-2 rounded-full bg-foam px-1 py-0.5">
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          decrement(productId);
        }}
        className={`${buttonSize} items-center justify-center rounded-full bg-white`}
        hitSlop={6}
      >
        <Ionicons
          name={quantity === 1 ? "trash-outline" : "remove"}
          size={iconSize}
          color="#10241F"
        />
      </Pressable>
      <Text className="min-w-5 text-center font-quicksand-bold text-sm text-dark-100">
        {quantity}
      </Text>
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          increment(productId);
        }}
        className={`${buttonSize} items-center justify-center rounded-full bg-primary`}
        hitSlop={6}
      >
        <Ionicons name="add" size={iconSize} color="white" />
      </Pressable>
    </View>
  );
}
