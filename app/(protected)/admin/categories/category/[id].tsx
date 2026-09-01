// VIEW — edit-category screen: finds the category from the cached admin
// list, then renders the shared form in edit mode.
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdminCategories } from "@/controllers/useAdmin";
import { CategoryForm } from "@/views/CategoryForm";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function EditCategory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: categories, isLoading } = useAdminCategories();
  const category = categories?.find((c) => c.id === id);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Editar categoría" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          {category ? (
            <CategoryForm category={category} />
          ) : isLoading ? (
            <ActivityIndicator className="mt-10" color="#3E8368" />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
