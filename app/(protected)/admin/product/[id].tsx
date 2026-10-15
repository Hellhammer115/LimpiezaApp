// VIEW — edit-product screen: fetches the product by id (the admin list is
// paged, so it can't be relied on to contain it), then renders the shared
// form in edit mode.
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdminProduct } from "@/controllers/useAdmin";
import { EmptyState } from "@/views/EmptyState";
import { ProductForm } from "@/views/ProductForm";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: product, isLoading, isError } = useAdminProduct(id);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Editar producto" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          {product ? (
            <ProductForm key={product.id} product={product} />
          ) : isLoading ? (
            <ActivityIndicator className="mt-10" color="#1B87C9" />
          ) : isError ? (
            <EmptyState icon="alert-circle-outline" title="No se pudo cargar el producto" />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
