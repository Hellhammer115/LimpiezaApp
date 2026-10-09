import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCategories, useProducts } from "@/controllers/useCatalog";
import { CategoryTile } from "@/views/CategoryTile";
import { EmptyState } from "@/views/EmptyState";
import { ProductCard } from "@/views/ProductCard";

const ICON_MUTED = "rgba(16,36,31,0.35)";
const GRID_COLUMNS = 3;

type Filler = { id: string; filler: true };

/** Pads a list with empty cells so the last row keeps the column width. */
function toGrid<T extends { id: string }>(
  items: T[],
  columns: number
): (T | Filler)[] {
  const cells: (T | Filler)[] = [...items];
  while (cells.length % columns !== 0) {
    cells.push({ id: `filler-${cells.length}`, filler: true });
  }
  return cells;
}

/**
 * VIEW — search tab. With an empty query it shows every category as a
 * 3-column grid; products appear only once the user types a search.
 */
export default function Search() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce the query 300ms behind the keystrokes.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const searching = search.length > 0;
  const { data: categories, isLoading: loadingCategories } = useCategories();
  const { data: products, isLoading: loadingProducts } = useProducts(
    { search },
    { enabled: searching }
  );

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <View className="border-b border-dark-100/5 px-5 pb-3 pt-4">
        <View className="searchbar px-4 py-3">
          <Ionicons name="search" size={18} color={ICON_MUTED} />
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Buscar productos..."
            placeholderTextColor={ICON_MUTED}
            className="flex-1 font-quicksand-medium text-dark-100"
            autoCorrect={false}
            returnKeyType="search"
          />
          {input.length > 0 ? (
            <Pressable onPress={() => setInput("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={ICON_MUTED} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {searching ? (
        loadingProducts ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#3E8368" />
          </View>
        ) : (
          <FlatList
            key="products"
            data={toGrid(products ?? [], 2)}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperClassName="gap-3 px-5"
            contentContainerClassName="py-4"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) =>
              "filler" in item ? (
                <View className="flex-1" />
              ) : (
                <ProductCard product={item} />
              )
            }
            ListEmptyComponent={
              <EmptyState
                icon="search-outline"
                title="Sin resultados"
                subtitle="Prueba con otra búsqueda"
              />
            }
          />
        )
      ) : loadingCategories ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3E8368" />
        </View>
      ) : (
        <FlatList
          key="categories"
          data={toGrid(categories ?? [], GRID_COLUMNS)}
          keyExtractor={(item) => item.id}
          numColumns={GRID_COLUMNS}
          columnWrapperClassName="gap-4 px-5"
          contentContainerClassName="gap-5 py-5"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) =>
            "filler" in item ? (
              <View className="flex-1" />
            ) : (
              <CategoryTile category={item} className="flex-1" />
            )
          }
          ListEmptyComponent={
            <EmptyState
              icon="grid-outline"
              title="Sin categorías"
              subtitle="Pronto agregaremos categorías"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
