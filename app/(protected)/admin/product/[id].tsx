// VIEW — edit-product screen: finds the product from the cached admin list,
// then renders the shared form in edit mode.
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdminProducts } from "@/controllers/useAdmin";
import { ProductForm } from "@/views/ProductForm";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: products, isLoading } = useAdminProducts();
  const product = products?.find((p) => p.id === id);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Editar producto" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          {product ? (
            <ProductForm product={product} />
          ) : isLoading ? (
            <ActivityIndicator className="mt-10" color="#3E8368" />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
