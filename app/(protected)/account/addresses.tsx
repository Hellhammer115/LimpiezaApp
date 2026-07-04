import { Ionicons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import { EmptyState } from "@/components/EmptyState";
import { FormInput } from "@/components/FormInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAddresses, useDeleteAddress, useSaveAddress } from "@/lib/queries";
import type { Address } from "@/lib/types";

const schema = z.object({
  label: z.string().trim().min(1, "Ej. Casa, Oficina"),
  street: z.string().trim().min(1, "Calle y número"),
  colonia: z.string().trim(),
  city: z.string().trim().min(1, "Ciudad"),
  zip: z.string().trim().regex(/^\d{5}$/, "C.P. a 5 dígitos"),
  notes: z.string().trim(),
});

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  label: "",
  street: "",
  colonia: "",
  city: "",
  zip: "",
  notes: "",
};

export default function Addresses() {
  const { data: addresses } = useAddresses();
  const saveAddress = useSaveAddress();
  const deleteAddress = useDeleteAddress();
  const [editing, setEditing] = useState<Address | "new" | null>(null);

  const { control, handleSubmit, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const openForm = (address: Address | "new") => {
    setEditing(address);
    reset(
      address === "new"
        ? EMPTY
        : {
            label: address.label,
            street: address.street,
            colonia: address.colonia,
            city: address.city,
            zip: address.zip,
            notes: address.notes ?? "",
          }
    );
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await saveAddress.mutateAsync({
        id: editing !== "new" && editing ? editing.id : undefined,
        ...values,
        notes: values.notes || undefined,
        is_default: addresses?.length === 0 ? true : undefined,
      });
      setEditing(null);
    } catch {
      Alert.alert("Error", "No se pudo guardar la dirección.");
    }
  });

  const confirmDelete = (address: Address) => {
    Alert.alert("Eliminar dirección", `¿Eliminar "${address.label}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => deleteAddress.mutate(address.id),
      },
    ]);
  };

  const setDefault = (address: Address) => {
    saveAddress.mutate({
      id: address.id,
      label: address.label,
      street: address.street,
      city: address.city,
      is_default: true,
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Mis direcciones" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="px-5 pb-10 pt-2"
          keyboardShouldPersistTaps="handled"
        >
          {(addresses ?? []).map((address) => (
            <View key={address.id} className="mb-3 rounded-2xl bg-white p-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <Text className="font-quicksand-bold text-dark-100">
                    {address.label}
                  </Text>
                  {address.is_default ? (
                    <View className="rounded-full bg-primary/15 px-2 py-0.5">
                      <Text className="font-quicksand-bold text-[10px] text-primary">
                        Principal
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View className="flex-row gap-3">
                  <Pressable onPress={() => openForm(address)} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={18} color="#3E8368" />
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(address)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color="#FF6B4A" />
                  </Pressable>
                </View>
              </View>
              <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/70">
                {address.street}
                {address.colonia ? `, ${address.colonia}` : ""}
              </Text>
              <Text className="font-quicksand-medium text-sm text-dark-100/70">
                {address.city} {address.zip}
              </Text>
              {!address.is_default ? (
                <Pressable onPress={() => setDefault(address)} className="mt-2">
                  <Text className="font-quicksand-semibold text-xs text-primary">
                    Usar como principal
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}

          {addresses?.length === 0 && editing === null ? (
            <EmptyState
              icon="location-outline"
              title="Sin direcciones"
              subtitle="Agrega una dirección para recibir tus pedidos"
            />
          ) : null}

          {editing !== null ? (
            <View className="mt-2 rounded-2xl bg-white p-4">
              <Text className="mb-3 font-quicksand-bold text-lg text-dark-100">
                {editing === "new" ? "Nueva dirección" : "Editar dirección"}
              </Text>
              <FormInput control={control} name="label" label="Etiqueta" placeholder="Casa" />
              <FormInput control={control} name="street" label="Calle y número" placeholder="Av. Siempre Viva 742" />
              <FormInput control={control} name="colonia" label="Colonia" placeholder="Centro" />
              <FormInput control={control} name="city" label="Ciudad" placeholder="Guadalajara" />
              <FormInput control={control} name="zip" label="Código postal" placeholder="44100" keyboardType="number-pad" />
              <FormInput control={control} name="notes" label="Referencias (opcional)" placeholder="Portón negro" />
              <View className="mt-2 gap-2">
                <PrimaryButton
                  title="Guardar dirección"
                  onPress={onSubmit}
                  loading={saveAddress.isPending}
                />
                <Pressable onPress={() => setEditing(null)} className="items-center py-2">
                  <Text className="font-quicksand-semibold text-dark-100/60">
                    Cancelar
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => openForm("new")}
              className="mt-2 flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-white p-4"
            >
              <Ionicons name="add" size={18} color="#3E8368" />
              <Text className="font-quicksand-bold text-primary">
                Agregar dirección
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
