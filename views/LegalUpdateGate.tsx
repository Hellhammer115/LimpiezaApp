import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "expo-router";
import { useForm } from "react-hook-form";
import { Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import { signOut } from "@/controllers/useAuth";
import { useAcceptLegal, type LegalDocument } from "@/controllers/useLegal";
import { CheckboxField } from "@/views/CheckboxField";
import { PrimaryButton } from "@/views/PrimaryButton";

const schema = z.object({
  accept: z.boolean().refine((v) => v, { message: "Debes aceptar para continuar" }),
});

type FormValues = z.infer<typeof schema>;

/**
 * VIEW — blocks the app until the signed-in user accepts the current
 * version of every legal document listed in `pending`. Rendered by the
 * (protected) layout in place of its Stack.
 */
export function LegalUpdateGate({ pending }: { pending: LegalDocument[] }) {
  const accept = useAcceptLegal();
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { accept: false },
  });

  const onSubmit = handleSubmit(async () => {
    try {
      await accept.mutateAsync(pending.map((d) => d.id));
    } catch {
      // Most likely a newer version was published meanwhile; the pending
      // list refetches on settle and the gate re-renders with it.
      Alert.alert("Error", "No se pudo registrar tu aceptación. Revisa los documentos e intenta de nuevo.");
    }
  });

  return (
    <SafeAreaView className="flex-1 bg-mist">
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10">
        <Text className="font-quicksand-bold text-3xl text-dark-100">
          Actualizamos nuestros documentos
        </Text>
        <Text className="mb-6 mt-2 font-quicksand-medium text-base text-dark-100/60">
          Para seguir usando la app, revisa y acepta:
        </Text>

        {pending.map((doc) => (
          <Link key={doc.id} href={`/legal/${doc.slug}`} asChild>
            <Text className="mb-3 font-quicksand-bold text-base text-primary underline">
              {doc.title} (versión {doc.version})
            </Text>
          </Link>
        ))}

        <View className="mt-4">
          <CheckboxField control={control} name="accept">
            <Text className="font-quicksand-medium text-sm text-dark-100">
              He leído y acepto {pending.length > 1 ? "los documentos" : "el documento"}{" "}
              {pending.length > 1 ? "actualizados" : "actualizado"}.
            </Text>
          </CheckboxField>
        </View>

        <View className="mt-2">
          <PrimaryButton
            title="Aceptar y continuar"
            onPress={onSubmit}
            loading={accept.isPending}
          />
        </View>

        <Text
          onPress={() => signOut()}
          className="mt-6 text-center font-quicksand-bold text-dark-100/60"
        >
          Cerrar sesión
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
