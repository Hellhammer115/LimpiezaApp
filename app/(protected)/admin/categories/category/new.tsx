// VIEW — create-category screen: thin wrapper around the shared form.
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryForm } from "@/views/CategoryForm";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function NewCategory() {
  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Nueva categoría" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          <CategoryForm />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
