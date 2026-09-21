import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useAdminCategories } from "@/controllers/useAdmin";
import { EmptyState } from "@/views/EmptyState";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** VIEW — admin category panel: list with active/inactive badges, tap to edit. */
export function AdminCategoryList() {
  const { data: categories, isLoading } = useAdminCategories();

  return (
    <ScrollView contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
      {(categories ?? []).map((category) => (
        <Pressable
          key={category.id}
          onPress={() => router.push(`/admin/categories/category/${category.id}`)}
          className="mb-3 flex-row items-center justify-between rounded-2xl bg-white p-4"
        >
          <View className="flex-1 flex-row items-center gap-3 pr-3">
            <View className="size-9 items-center justify-center rounded-full bg-foam">
              <Ionicons name={category.icon as IconName} size={18} color="#3E8368" />
            </View>
            <View>
              <Text className="font-quicksand-bold text-dark-100">{category.name}</Text>
              <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
                Orden {category.sort_order}
              </Text>
            </View>
          </View>
          <View
            className={`rounded-full px-2 py-0.5 ${category.is_active ? "bg-primary/15" : "bg-coral/15"}`}
          >
            <Text
              className={`font-quicksand-bold text-[10px] ${category.is_active ? "text-primary" : "text-coral"}`}
            >
              {category.is_active ? "Activa" : "Inactiva"}
            </Text>
          </View>
        </Pressable>
      ))}

      {!isLoading && categories?.length === 0 ? (
        <EmptyState
          icon="pricetag-outline"
          title="Sin categorías"
          subtitle="Crea la primera con el botón +"
        />
      ) : null}
    </ScrollView>
  );
}
