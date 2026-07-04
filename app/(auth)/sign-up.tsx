import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import { FormInput } from "@/components/FormInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { supabase } from "@/lib/supabase";

const schema = z
  .object({
    name: z.string().trim().min(1, "Ingresa tu nombre"),
    last_name: z.string().trim().min(1, "Ingresa tu apellido"),
    phone: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "Teléfono a 10 dígitos"),
    email: z.string().trim().email("Correo inválido"),
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

export default function SignUp() {
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      last_name: "",
      phone: "",
      email: "",
      password: "",
      confirm: "",
    },
  });

  const onSubmit = handleSubmit(async ({ name, last_name, phone, email, password }) => {
    setSubmitting(true);
    // The profile row is created by a database trigger from this metadata;
    // the password is stored hashed by Supabase Auth, never in our tables.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, last_name, phone } },
    });
    setSubmitting(false);
    if (error) {
      Alert.alert("Error", "No se pudo crear la cuenta. Intenta de nuevo.");
      return;
    }
    if (!data.session) {
      Alert.alert(
        "Confirma tu correo",
        "Te enviamos un enlace de confirmación. Revísalo para activar tu cuenta.",
        [{ text: "OK", onPress: () => router.replace("/sign-in") }]
      );
    }
  });

  return (
    <SafeAreaView className="flex-1 bg-mist">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="font-quicksand-bold text-3xl text-dark-100">
            Crea tu cuenta
          </Text>
          <Text className="mb-8 mt-1 font-quicksand-medium text-base text-dark-100/60">
            Frutas, verduras y limpieza a tu puerta
          </Text>

          <FormInput control={control} name="name" label="Nombre" placeholder="María" autoComplete="given-name" />
          <FormInput control={control} name="last_name" label="Apellido" placeholder="García" autoComplete="family-name" />
          <FormInput
            control={control}
            name="phone"
            label="Teléfono"
            placeholder="5512345678"
            keyboardType="phone-pad"
            autoComplete="tel"
          />
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
              title="Crear cuenta"
              onPress={onSubmit}
              loading={submitting}
            />
          </View>

          <View className="mt-6 flex-row justify-center gap-1">
            <Text className="font-quicksand-medium text-dark-100/60">
              ¿Ya tienes cuenta?
            </Text>
            <Link href="/sign-in" asChild>
              <Text className="font-quicksand-bold text-primary">
                Inicia sesión
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
