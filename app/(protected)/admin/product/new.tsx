// VIEW — create-product screen: thin wrapper around the shared form.
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductForm } from "@/views/ProductForm";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function NewProduct() {
  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Nuevo producto" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          <ProductForm />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
