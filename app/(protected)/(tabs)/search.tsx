import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ProductCard } from "@/components/ProductCard";
import { useCategories, useProducts } from "@/lib/queries";

export default function Search() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);

  // Debounce the query 300ms behind the keystrokes.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const { data: categories } = useCategories();
  const { data: products, isLoading } = useProducts({
    categoryId,
    search: search || undefined,
  });

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <View className="px-5 pt-4">
        <View className="searchbar px-4 py-3">
          <Ionicons name="search" size={18} color="rgba(16,36,31,0.35)" />
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Buscar productos..."
            placeholderTextColor="rgba(16,36,31,0.35)"
            className="flex-1 font-quicksand-medium text-dark-100"
            autoCorrect={false}
            returnKeyType="search"
          />
          {input.length > 0 ? (
            <Pressable onPress={() => setInput("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="rgba(16,36,31,0.35)" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View className="mt-4">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-5"
        >
          <Pressable
            onPress={() => setCategoryId(undefined)}
            className={categoryId === undefined ? "chip-active" : "chip"}
          >
            <Text
              className={`font-quicksand-semibold text-sm ${
                categoryId === undefined ? "text-white" : "text-dark-100"
              }`}
            >
              Todo
            </Text>
          </Pressable>
          {(categories ?? []).map((category) => {
            const active = category.id === categoryId;
            return (
              <Pressable
                key={category.id}
                onPress={() => setCategoryId(active ? undefined : category.id)}
                className={active ? "chip-active" : "chip"}
              >
                <Text
                  className={`font-quicksand-semibold text-sm ${
                    active ? "text-white" : "text-dark-100"
                  }`}
                >
                  {category.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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
          contentContainerClassName="gap-0 py-4"
          renderItem={({ item }) => <ProductCard product={item} />}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="Sin resultados"
              subtitle="Prueba con otra búsqueda o categoría"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
