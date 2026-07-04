import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PrimaryButton } from "@/views/PrimaryButton";
import { QuantityStepper } from "@/views/QuantityStepper";
import { ScreenHeader } from "@/views/ScreenHeader";
import { useCart, useCartCount, useInCart } from "@/controllers/useCart";
import { useProduct } from "@/controllers/useCatalog";
import { formatMXN } from "@/utils/format";

/** VIEW — product detail: image, price, description, add-to-cart bar. */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: product, isLoading } = useProduct(id);
  const inCart = useInCart(id ?? "");
  const count = useCartCount();
  const add = useCart((s) => s.add);

  if (isLoading || !product) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist">
        <ActivityIndicator color="#3E8368" />
      </SafeAreaView>
    );
  }

  const outOfStock = product.stock <= 0;

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="" />
      <ScrollView contentContainerClassName="pb-32">
        <View className="mx-5 h-64 items-center justify-center rounded-3xl bg-foam">
          {product.image_url ? (
            <Image
              source={{ uri: product.image_url }}
              style={{ width: "100%", height: "100%", borderRadius: 24 }}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <Ionicons name="basket-outline" size={64} color="#3E8368" />
          )}
        </View>

        <View className="px-5 pt-5">
          <Text className="font-quicksand-bold text-2xl text-dark-100">
            {product.name}
          </Text>
          <Text className="mt-1 font-quicksand-medium text-dark-100/50">
            Por {product.unit}
          </Text>
          <Text className="mt-3 font-quicksand-bold text-3xl text-primary">
            {formatMXN(product.price_cents)}
          </Text>

          {product.description ? (
            <>
              <Text className="mt-6 font-quicksand-bold text-lg text-dark-100">
                Descripción
              </Text>
              <Text className="mt-1 font-quicksand-medium leading-5 text-dark-100/70">
                {product.description}
              </Text>
            </>
          ) : null}

          {outOfStock ? (
            <View className="mt-6 rounded-2xl bg-coral/10 p-4">
              <Text className="font-quicksand-bold text-coral">
                Producto agotado
              </Text>
            </View>
          ) : product.stock <= 5 ? (
            <Text className="mt-4 font-quicksand-semibold text-sm text-citrus">
              ¡Quedan solo {product.stock}!
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Bottom action bar */}
      <View className="absolute bottom-0 left-0 right-0 flex-row items-center gap-3 border-t border-dark-100/5 bg-white px-5 pb-8 pt-4">
        {inCart ? (
          <>
            <QuantityStepper productId={product.id} />
            <View className="flex-1">
              <PrimaryButton
                title={`Ver carrito (${count})`}
                onPress={() => router.push("/cart")}
              />
            </View>
          </>
        ) : (
          <View className="flex-1">
            <PrimaryButton
              title="Agregar al carrito"
              onPress={() => add(product)}
              disabled={outOfStock}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
