import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import { signIn } from "@/controllers/useAuth";
import { FormInput } from "@/views/FormInput";
import { PrimaryButton } from "@/views/PrimaryButton";

const schema = z.object({
  email: z.string().trim().email("Correo inválido"),
  password: z.string().min(1, "Ingresa tu contraseña"),
});

type FormValues = z.infer<typeof schema>;

/** VIEW — sign-in screen: validates the form and delegates to the auth controller. */
export default function SignIn() {
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  /** Attempts sign-in; on success the (auth) layout redirects automatically. */
  const onSubmit = handleSubmit(async ({ email, password }) => {
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch {
      // Generic message: never reveal whether the email exists.
      Alert.alert("Error", "Correo o contraseña incorrectos.");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <SafeAreaView className="flex-1 bg-mist">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 pb-10"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="font-quicksand-bold text-3xl text-dark-100">
            Hola de nuevo 👋
          </Text>
          <Text className="mb-8 mt-1 font-quicksand-medium text-base text-dark-100/60">
            Inicia sesión para hacer tu pedido
          </Text>

          <FormInput
            control={control}
            name="email"
            label="Correo electrónico"
            placeholder="tu@correo.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <FormInput
            control={control}
            name="password"
            label="Contraseña"
            placeholder="Tu contraseña"
            secureTextEntry
            autoComplete="password"
          />

          <View className="mt-4">
            <PrimaryButton
              title="Iniciar sesión"
              onPress={onSubmit}
              loading={submitting}
            />
          </View>

          <View className="mt-6 flex-row justify-center gap-1">
            <Text className="font-quicksand-medium text-dark-100/60">
              ¿No tienes cuenta?
            </Text>
            <Link href="/sign-up" asChild>
              <Text className="font-quicksand-bold text-primary">
                Crea una
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
