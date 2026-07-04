import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/views/EmptyState";
import { ProductCard } from "@/views/ProductCard";
import { ScreenHeader } from "@/views/ScreenHeader";
import { useCategory, useProducts } from "@/controllers/useCatalog";

/** VIEW — category screen: two-column product grid for one category. */
export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: category } = useCategory(id);
  const { data: products, isLoading } = useProducts({ categoryId: id });

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title={category?.name ?? "Categoría"} />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3E8368" />
        </View>
      ) : (
        <FlatList
          data={products ?? []}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperClassName="gap-3 px-5"
          contentContainerClassName="py-2"
          renderItem={({ item }) => <ProductCard product={item} />}
          ListEmptyComponent={
            <EmptyState
              title="Sin productos"
              subtitle="Pronto agregaremos productos a esta categoría"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
