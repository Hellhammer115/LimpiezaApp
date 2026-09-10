// VIEW — shared form for creating and editing a category (admin only).
// Presence of `category` picks the mode: undefined = create, set = edit.
import { Ionicons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { useForm } from "react-hook-form";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { z } from "zod";

import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/controllers/useAdmin";
import type { AdminCategory } from "@/models/types";
import { formatDate } from "@/utils/format";
import { FormInput } from "@/views/FormInput";
import { PrimaryButton } from "@/views/PrimaryButton";

type IconName = ComponentProps<typeof Ionicons>["name"];

const ICON_OPTIONS: IconName[] = [
  "flash-outline",
  "leaf-outline",
  "sparkles-outline",
  "nutrition-outline",
  "water-outline",
  "basket-outline",
  "cart-outline",
  "restaurant-outline",
  "home-outline",
  "flask-outline",
  "shirt-outline",
  "medkit-outline",
];

const schema = z.object({
  name: z.string().trim().min(1, "Nombre requerido"),
  icon: z.string().min(1, "Selecciona un ícono"),
  sort_order: z.string().trim().regex(/^\d+$/, "Orden inválido"),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function CategoryForm({ category }: { category?: AdminCategory }) {
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: category?.name ?? "",
      icon: category?.icon ?? ICON_OPTIONS[0],
      sort_order: category ? String(category.sort_order) : "0",
      is_active: category?.is_active ?? true,
    },
  });

  const icon = watch("icon");
  const isActive = watch("is_active");

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (category) {
        // Edit mode: only send fields the admin actually changed in this
        // session, same pattern as ProductForm — the cached category can be
        // stale relative to another admin's concurrent edit.
        const patch: Partial<{
          name: string;
          icon: string;
          sort_order: number;
          is_active: boolean;
        }> = {};
        if (dirtyFields.name) patch.name = values.name;
        if (dirtyFields.icon) patch.icon = values.icon;
        if (dirtyFields.sort_order) patch.sort_order = parseInt(values.sort_order, 10);
        if (dirtyFields.is_active) patch.is_active = values.is_active;

        await updateCategory.mutateAsync({ id: category.id, patch });
      } else {
        await createCategory.mutateAsync({
          name: values.name,
          icon: values.icon,
          sort_order: parseInt(values.sort_order, 10),
          is_active: values.is_active,
        });
      }
      router.back();
    } catch {
      Alert.alert("Error", "No se pudo guardar la categoría.");
    }
  });

  const confirmDelete = () => {
    if (!category) return;
    Alert.alert("Eliminar categoría", `¿Desactivar "${category.name}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteCategory.mutateAsync(category.id);
            router.back();
          } catch {
            Alert.alert("Error", "No se pudo eliminar la categoría.");
          }
        },
      },
    ]);
  };

  const saving = createCategory.isPending || updateCategory.isPending;

  return (
    <View className="px-5 pb-10 pt-2">
      <FormInput control={control} name="name" label="Nombre" />

      <Text className="label mb-1">Ícono</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {ICON_OPTIONS.map((option) => {
          const active = option === icon;
          return (
            <Pressable
              key={option}
              onPress={() => setValue("icon", option, { shouldValidate: true, shouldDirty: true })}
              className={`size-11 items-center justify-center rounded-full ${active ? "bg-primary" : "bg-white"}`}
            >
              <Ionicons name={option} size={20} color={active ? "white" : "#3E8368"} />
            </Pressable>
          );
        })}
      </View>

      <FormInput control={control} name="sort_order" label="Orden" keyboardType="number-pad" />

      <View className="mb-4 flex-row items-center justify-between rounded-2xl bg-white p-4">
        <Text className="font-quicksand-bold text-dark-100">Activa</Text>
        <Switch value={isActive} onValueChange={(v) => setValue("is_active", v, { shouldDirty: true })} trackColor={{ true: "#3E8368" }} />
      </View>

      {category ? (
        <Text className="mb-4 font-quicksand-medium text-xs text-dark-100/50">
          Última edición: {category.updated_by_email ?? "—"} · {formatDate(category.updated_at)}
        </Text>
      ) : null}

      <PrimaryButton
        title={category ? "Guardar cambios" : "Crear categoría"}
        onPress={onSubmit}
        loading={saving}
      />

      {category ? (
        <Pressable onPress={confirmDelete} className="mt-3 items-center py-2">
          <Text className="font-quicksand-semibold text-coral">Eliminar categoría</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
