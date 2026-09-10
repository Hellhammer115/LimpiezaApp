import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import { requestPasswordReset, resetPassword } from "@/controllers/useAuth";
import { FormInput } from "@/views/FormInput";
import { PrimaryButton } from "@/views/PrimaryButton";

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Código de 6 dígitos"),
    password: z
      .string()
      .min(8, "Mínimo 8 caracteres")
      .regex(/[A-Za-z]/, "Debe incluir letras")
      .regex(/\d/, "Debe incluir números"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "Las contraseñas no coinciden",
  });

type FormValues = z.infer<typeof schema>;

/**
 * VIEW — step 2 of password recovery: the emailed code and the new password
 * are submitted together on purpose. Verifying the code starts a session,
 * which makes the (auth) guard redirect to home — so there is no room for a
 * second screen in between.
 */
export default function ResetPassword() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "", password: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async ({ code, password }) => {
    if (!email) return;
    setSubmitting(true);
    try {
      await resetPassword(email, code, password);
      // The new session makes the (auth) guard land the user on home.
      Alert.alert("Listo", "Tu contraseña fue actualizada.");
    } catch {
      Alert.alert(
        "Código inválido",
        "El código es incorrecto o expiró. Solicita uno nuevo."
      );
    } finally {
      setSubmitting(false);
    }
  });

  const resend = async () => {
    if (!email) return;
    try {
      await requestPasswordReset(email);
      Alert.alert("Código enviado", "Revisa tu correo de nuevo.");
    } catch {
      Alert.alert("Error", "No se pudo reenviar el código.");
    }
  };

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
            Nueva contraseña
          </Text>
          <Text className="mb-8 mt-1 font-quicksand-medium text-base text-dark-100/60">
            Enviamos un código a {email}
          </Text>

          <FormInput
            control={control}
            name="code"
            label="Código de verificación"
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
          />
          <FormInput
            control={control}
            name="password"
            label="Nueva contraseña"
            placeholder="Mínimo 8 caracteres"
            secureTextEntry
            autoComplete="new-password"
          />
          <FormInput
            control={control}
            name="confirm"
            label="Confirmar contraseña"
            placeholder="Repite tu contraseña"
            secureTextEntry
            autoComplete="new-password"
          />

          <View className="mt-4">
            <PrimaryButton
              title="Cambiar contraseña"
              onPress={onSubmit}
              loading={submitting}
            />
          </View>

          <View className="mt-6 flex-row justify-center gap-1">
            <Text className="font-quicksand-medium text-dark-100/60">
              ¿No llegó?
            </Text>
            <Text onPress={resend} className="font-quicksand-bold text-primary">
              Reenviar código
            </Text>
          </View>

          <View className="mt-3 flex-row justify-center">
            <Text
              onPress={() => router.replace("/sign-in")}
              className="font-quicksand-medium text-dark-100/60"
            >
              Volver a iniciar sesión
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
