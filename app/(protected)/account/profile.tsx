import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import { FormInput } from "@/components/FormInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useProfile, useUpdateProfile } from "@/lib/queries";

const schema = z.object({
  name: z.string().trim().min(1, "Ingresa tu nombre"),
  last_name: z.string().trim().min(1, "Ingresa tu apellido"),
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Teléfono a 10 dígitos"),
});

type FormValues = z.infer<typeof schema>;

export default function EditProfile() {
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();

  const { control, handleSubmit, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", last_name: "", phone: "" },
  });

  useEffect(() => {
    if (profile) {
      reset({
        name: profile.name,
        last_name: profile.last_name,
        phone: profile.phone ?? "",
      });
    }
  }, [profile, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateProfile.mutateAsync({
        name: values.name,
        last_name: values.last_name,
        phone: values.phone || null,
      });
      router.back();
    } catch {
      Alert.alert("Error", "No se pudo guardar. Intenta de nuevo.");
    }
  });

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Editar perfil" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="px-6 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          <FormInput control={control} name="name" label="Nombre" />
          <FormInput control={control} name="last_name" label="Apellido" />
          <FormInput
            control={control}
            name="phone"
            label="Teléfono"
            keyboardType="phone-pad"
          />
          <View className="mt-4">
            <PrimaryButton
              title="Guardar"
              onPress={onSubmit}
              loading={updateProfile.isPending}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
