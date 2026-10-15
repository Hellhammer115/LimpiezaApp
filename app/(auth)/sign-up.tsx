import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import {
  SignUpError,
  nameSchema,
  passwordSchema,
  phoneSchema,
  signUp,
} from "@/controllers/useAuth";
import { legalVersionsOf, useCurrentLegalDocuments } from "@/controllers/useLegal";
import { CaptchaCancelled } from "@/views/captchaTypes";
import { CheckboxField } from "@/views/CheckboxField";
import { FormInput } from "@/views/FormInput";
import { PasswordInput } from "@/views/PasswordInput";
import { PrimaryButton } from "@/views/PrimaryButton";
import { useCaptcha } from "@/views/useCaptcha";

const schema = z
  .object({
    name: nameSchema("Ingresa tu nombre"),
    last_name: nameSchema("Ingresa tu apellido"),
    phone: phoneSchema,
    email: z.string().trim().email("Correo inválido"),
    password: passwordSchema,
    confirm: z.string(),
    // Must be ticked by the user; never pre-checked.
    acceptLegal: z.boolean().refine((v) => v, {
      message: "Debes aceptar los Términos y el Aviso de Privacidad",
    }),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "Las contraseñas no coinciden",
  });

type FormValues = z.infer<typeof schema>;

/** VIEW — sign-up screen: validates the form and delegates to the auth controller. */
export default function SignUp() {
  const [submitting, setSubmitting] = useState(false);
  const captcha = useCaptcha();
  const legal = useCurrentLegalDocuments();
  const legalVersions = legal.data ? legalVersionsOf(legal.data) : null;
  const { control, handleSubmit, setError, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      last_name: "",
      phone: "",
      email: "",
      password: "",
      confirm: "",
      acceptLegal: false,
    },
  });

  /**
   * Creates the account through the auth controller. When e-mail
   * confirmation is enabled the session starts only after the user clicks
   * the link, so we send them back to sign-in with instructions.
   *
   * A taken e-mail or phone becomes an inline error on that field —
   * an Alert would leave the user guessing which one collided.
   */
  const onSubmit = handleSubmit(async ({ name, last_name, phone, email, password }) => {
    if (!legalVersions) return;
    setSubmitting(true);
    try {
      const captchaToken = await captcha.execute();
      const sessionStarted = await signUp({
        name,
        last_name,
        phone,
        email,
        password,
        legalVersions,
        captchaToken,
      });
      if (!sessionStarted) {
        Alert.alert(
          "Confirma tu correo",
          "Te enviamos un enlace de confirmación. Revísalo para activar tu cuenta.",
          [{ text: "OK", onPress: () => router.replace("/sign-in") }]
        );
      }
    } catch (error) {
      const reason = error instanceof SignUpError ? error.reason : null;
      if (error instanceof CaptchaCancelled) {
        Alert.alert("Verificación", "Completa la verificación para continuar.");
      } else if (reason === "email_taken") {
        setError("email", { message: "Ese correo ya tiene una cuenta" });
      } else if (reason === "phone_taken") {
        setError("phone", { message: "Ese teléfono ya está registrado" });
      } else if (reason === "weak_password") {
        setError("password", { message: "La contraseña no cumple los requisitos" });
      } else if (reason === "captcha_failed") {
        Alert.alert("Verificación", "La verificación falló, intenta de nuevo.");
      } else if (reason === "terms_outdated") {
        // A new version was published while the form was open: make the
        // user review and tick it again.
        setValue("acceptLegal", false);
        setError("acceptLegal", { message: "Los documentos se actualizaron. Revísalos y acéptalos de nuevo." });
        void legal.refetch();
      } else {
        Alert.alert("Error", "No se pudo crear la cuenta. Intenta de nuevo.");
      }
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
          <PasswordInput
            control={control}
            name="password"
            label="Contraseña"
            placeholder="Mínimo 8 caracteres, letras y números"
            autoComplete="new-password"
          />
          <PasswordInput
            control={control}
            name="confirm"
            label="Confirmar contraseña"
            placeholder="Repite tu contraseña"
            autoComplete="new-password"
          />

          <View className="mt-2">
            <CheckboxField control={control} name="acceptLegal">
              <Text className="font-quicksand-medium text-sm leading-5 text-dark-100">
                He leído y acepto los{" "}
                <Link href="/legal/terms" className="font-quicksand-bold text-primary underline">
                  Términos y Condiciones
                </Link>{" "}
                y el{" "}
                <Link href="/legal/privacy" className="font-quicksand-bold text-primary underline">
                  Aviso de Privacidad
                </Link>
                .
              </Text>
            </CheckboxField>
          </View>

          <View className="mt-2">
            <PrimaryButton
              title="Crear cuenta"
              onPress={onSubmit}
              loading={submitting}
              disabled={!legalVersions}
            />
          </View>
          {legal.isError ? (
            <Text className="mt-2 text-center font-quicksand-medium text-xs text-coral">
              No se pudieron cargar los términos. Revisa tu conexión.
            </Text>
          ) : null}

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
      {captcha.element}
    </SafeAreaView>
  );
}
