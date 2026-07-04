import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { QuantityStepper } from "@/components/QuantityStepper";
import { formatMXN } from "@/lib/format";
import type { Product } from "@/lib/types";
import { useCart } from "@/store/cart";

export function ProductCard({ product }: { product: Product }) {
  // Boolean selector: only this card re-renders when ITS cart state changes.
  const inCart = useCart((s) =>
    s.items.some((i) => i.productId === product.id)
  );
  const add = useCart((s) => s.add);
  const outOfStock = product.stock <= 0;

  return (
    <Pressable
      onPress={() => router.push(`/product/${product.id}`)}
      className="mb-3 flex-1 rounded-2xl bg-white p-3"
    >
      <View className="h-28 items-center justify-center rounded-xl bg-foam">
        {product.image_url ? (
          <Image
            source={{ uri: product.image_url }}
            style={{ width: "100%", height: "100%", borderRadius: 12 }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <Ionicons name="basket-outline" size={34} color="#3E8368" />
        )}
      </View>

      <Text
        numberOfLines={2}
        className="mt-2 min-h-[36px] font-quicksand-semibold text-sm leading-4 text-dark-100"
      >
        {product.name}
      </Text>
      <Text className="mt-0.5 font-quicksand-medium text-xs text-dark-100/50">
        {product.unit}
      </Text>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="font-quicksand-bold text-base text-dark-100">
          {formatMXN(product.price_cents)}
        </Text>
        {outOfStock ? (
          <Text className="font-quicksand-semibold text-xs text-coral">
            Agotado
          </Text>
        ) : inCart ? (
          <QuantityStepper productId={product.id} compact />
        ) : (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              add(product);
            }}
            className="size-8 items-center justify-center rounded-full bg-primary"
            hitSlop={8}
          >
            <Ionicons name="add" size={18} color="white" />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}
