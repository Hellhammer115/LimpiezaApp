import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryTile } from "@/views/CategoryTile";
import { ProductCard } from "@/views/ProductCard";
import { useCartCount } from "@/controllers/useCart";
import { useCategories, useProducts } from "@/controllers/useCatalog";

const ICON_MUTED = "rgba(16,36,31,0.35)";

/** VIEW — home tab: search, categories, featured. */
export default function Home() {
  const { data: categories } = useCategories();
  const { data: featured } = useProducts({ limit: 6 });
  // Primitive selector so the screen re-renders only when the count changes.
  const count = useCartCount();

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-6"
      >
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

        {/* Categories */}
        <Text className="mb-3 mt-6 px-5 font-quicksand-bold text-2xl text-dark-100">
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
