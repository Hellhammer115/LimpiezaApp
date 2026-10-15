import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCurrentLegalDocuments } from "@/controllers/useLegal";
import { EmptyState } from "@/views/EmptyState";
import { ScreenHeader } from "@/views/ScreenHeader";

/**
 * VIEW — current version of a legal document (terms / privacy). Lives
 * outside the (auth)/(protected) groups so it's reachable both before
 * sign-up and from inside the app.
 */
export default function LegalDocumentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, isLoading } = useCurrentLegalDocuments();
  const document = data?.find((d) => d.slug === slug);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title={document?.title ?? "Documento legal"} />
      {isLoading ? (
        <ActivityIndicator className="mt-10" />
      ) : !document ? (
        <EmptyState title="Documento no disponible" />
      ) : (
        <ScrollView contentContainerClassName="px-6 pb-12 pt-2">
          <View className="mb-4">
            <Text className="font-quicksand-medium text-sm text-dark-100/60">
              Versión {document.version} · Publicada el{" "}
              {new Date(document.published_at).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </Text>
          </View>
          <Text selectable className="font-quicksand text-base leading-6 text-dark-100">
            {document.body}
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
