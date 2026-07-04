import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryTile } from "@/components/CategoryTile";
import { ProductCard } from "@/components/ProductCard";
import { PromoCarousel } from "@/components/PromoCarousel";
import { DEMO_MODE } from "@/lib/demo";
import {
  FREE_DELIVERY_THRESHOLD_CENTS,
} from "@/lib/delivery";
import { formatMXN } from "@/lib/format";
import { useCategories, useProducts } from "@/lib/queries";
import { cartCount, cartSubtotalCents, useCart } from "@/store/cart";

const ICON_MUTED = "rgba(16,36,31,0.35)";
const ICON_PRIMARY = "#3E8368";

export default function Home() {
  const { data: categories } = useCategories();
  const { data: featured } = useProducts({ limit: 6 });
  // Primitive selectors so the screen re-renders only when these change.
  const subtotal = useCart((s) => cartSubtotalCents(s.items));
  const count = useCart((s) => cartCount(s.items));
  const progress = Math.min(subtotal / FREE_DELIVERY_THRESHOLD_CENTS, 1);
  const remaining = Math.max(FREE_DELIVERY_THRESHOLD_CENTS - subtotal, 0);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-6"
      >
        {/* Demo badge: visible confirmation that the demo bundle is running */}
        {DEMO_MODE ? (
          <View className="mx-5 mt-2 self-start rounded-full bg-citrus px-3 py-1">
            <Text className="font-quicksand-bold text-[11px] text-dark-100">
              DEMO · sin cuenta
            </Text>
          </View>
        ) : null}

        {/* Header */}
        <View className="flex-row items-center gap-3 px-5 pt-4">
          <Pressable
            onPress={() => router.push("/search")}
            className="searchbar flex-1 px-4 py-3"
          >
            <Ionicons name="search" size={18} color={ICON_MUTED} />
            <Text className="flex-1 font-quicksand-medium text-dark-100/40">
              Buscar productos...
            </Text>
          </Pressable>
          <Pressable onPress={() => router.push("/cart")} className="cart-btn">
            <Ionicons name="bag-outline" size={20} color="white" />
            {count > 0 ? (
              <View className="cart-badge">
                <Text className="text-[10px] font-quicksand-bold text-white">
                  {count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Promo carousel */}
        <View className="mt-5">
          <PromoCarousel />
        </View>

        {/* Free delivery progress */}
        <View className="mx-5 mt-5 rounded-2xl bg-white p-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="font-quicksand-semibold text-xs text-dark-100/50">
              $0
            </Text>
            <Text className="font-quicksand-semibold text-xs text-dark-100/50">
              {formatMXN(FREE_DELIVERY_THRESHOLD_CENTS)}
            </Text>
          </View>
          <View className="relative">
            <View className="h-2 overflow-hidden rounded-full bg-foam">
              <View
                className="h-full rounded-full bg-primary"
                style={{ width: `${progress * 100}%` }}
              />
            </View>
            <View
              className="absolute -top-1.5 size-5 items-center justify-center rounded-full bg-white shadow-sm shadow-black/20"
              style={{ left: `${progress * 100}%`, marginLeft: -10 }}
            >
              <Ionicons name="sparkles" size={11} color={ICON_PRIMARY} />
            </View>
          </View>
          <Text className="mt-4 font-quicksand-bold text-dark-100">
            {remaining > 0
              ? `${formatMXN(remaining)} para envío gratis`
              : "¡Tienes envío gratis! 🎉"}
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <Text className="font-quicksand-medium text-sm text-dark-100/60">
              Envío gratis desde {formatMXN(FREE_DELIVERY_THRESHOLD_CENTS)}
            </Text>
            <Ionicons
              name="information-circle-outline"
              size={15}
              color={ICON_MUTED}
            />
          </View>
        </View>

        {/* Next delivery */}
        <View className="info-row mx-5 mt-4">
          <View className="info-row__icon">
            <Ionicons name="time-outline" size={20} color={ICON_PRIMARY} />
          </View>
          <View className="flex-1">
            <Text className="font-quicksand-bold text-dark-100">
              Siguiente entrega disponible
            </Text>
            <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
              Hoy, 6pm – 8pm · Col. Centro
            </Text>
          </View>
        </View>

        {/* Categories */}
        <Text className="mb-3 mt-7 px-5 font-quicksand-bold text-2xl text-dark-100">
          Categorías
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-5"
        >
          {(categories ?? []).map((category) => (
            <CategoryTile key={category.id} category={category} />
          ))}
        </ScrollView>

        {/* Featured products */}
        <Text className="mb-3 mt-7 px-5 font-quicksand-bold text-2xl text-dark-100">
          Populares
        </Text>
        <View className="flex-row flex-wrap gap-3 px-5">
          {(featured ?? []).map((product) => (
            <View key={product.id} className="w-[47%]">
              <ProductCard product={product} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
