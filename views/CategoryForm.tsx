// VIEW — shared form for creating and editing a category (admin only).
// Presence of `category` picks the mode: undefined = create, set = edit.
import { Ionicons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { z } from "zod";

import {
  useCreateCategory,
  useUpdateCategory,
  useUploadCatalogImage,
} from "@/controllers/useAdmin";
import type { CategoryInput } from "@/models/adminModel";
import type { AdminCategory } from "@/models/types";
import { formatDate } from "@/utils/format";
import { DeleteCategoryDialog } from "@/views/DeleteCategoryDialog";
import { FormInput } from "@/views/FormInput";
import { IconPicker } from "@/views/IconPicker";
import { PrimaryButton } from "@/views/PrimaryButton";

const DEFAULT_ICON = "pricetag-outline";

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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const uploadImage = useUploadCatalogImage("category");

  // The photo is optional; the icon stays required as the fallback tile.
  const [imageUrl, setImageUrl] = useState<string | null>(category?.image_url ?? null);

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
      icon: category?.icon ?? DEFAULT_ICON,
      sort_order: category ? String(category.sort_order) : "0",
      is_active: category?.is_active ?? true,
    },
  });

  const icon = watch("icon");
  const isActive = watch("is_active");

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso requerido", "Habilita acceso a tus fotos para elegir una imagen.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    try {
      const url = await uploadImage.mutateAsync({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      });
      setImageUrl(url);
    } catch {
      Alert.alert("Error", "No se pudo subir la imagen.");
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (category) {
        // Edit mode: only send fields the admin actually changed in this
        // session, same pattern as ProductForm — the cached category can be
        // stale relative to another admin's concurrent edit.
        const patch: Partial<CategoryInput> = {};
        if (dirtyFields.name) patch.name = values.name;
        if (dirtyFields.icon) patch.icon = values.icon;
        if (dirtyFields.sort_order) patch.sort_order = parseInt(values.sort_order, 10);
        if (dirtyFields.is_active) patch.is_active = values.is_active;
        if (imageUrl !== (category.image_url ?? null)) patch.image_url = imageUrl;

        await updateCategory.mutateAsync({ id: category.id, patch });
      } else {
        await createCategory.mutateAsync({
          name: values.name,
          icon: values.icon,
          image_url: imageUrl,
          sort_order: parseInt(values.sort_order, 10),
          is_active: values.is_active,
        });
      }
      router.back();
    } catch {
      Alert.alert("Error", "No se pudo guardar la categoría.");
    }
  });

  const saving = createCategory.isPending || updateCategory.isPending || uploadImage.isPending;

  return (
    <View className="px-5 pb-10 pt-2">
      <FormInput control={control} name="name" label="Nombre" />

      <Text className="label mb-1">Imagen (opcional)</Text>
      <Pressable
        onPress={pickImage}
        className="mb-2 aspect-square w-40 items-center justify-center self-center overflow-hidden rounded-2xl bg-white"
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        ) : (
          <View className="items-center px-3">
            <Ionicons name="camera-outline" size={28} color="#1B87C9" />
            <Text className="mt-1 text-center font-quicksand-semibold text-sm text-dark-100/60">
              {uploadImage.isPending ? "Subiendo…" : "Agregar imagen"}
            </Text>
          </View>
        )}
      </Pressable>
      {imageUrl ? (
        <Pressable onPress={() => setImageUrl(null)} className="mb-4 items-center py-1">
          <Text className="font-quicksand-semibold text-sm text-coral">Quitar imagen</Text>
        </Pressable>
      ) : (
        <Text className="mb-4 text-center font-quicksand-medium text-xs text-dark-100/50">
          Sin imagen, la categoría se muestra con su ícono.
        </Text>
      )}

      <Text className="label mb-1">Ícono</Text>
      <IconPicker
        value={icon}
        onChange={(option) => setValue("icon", option, { shouldValidate: true, shouldDirty: true })}
      />

      <FormInput control={control} name="sort_order" label="Orden" keyboardType="number-pad" />

      <View className="mb-4 flex-row items-center justify-between rounded-2xl bg-white p-4">
        <Text className="font-quicksand-bold text-dark-100">Activa</Text>
        <Switch value={isActive} onValueChange={(v) => setValue("is_active", v, { shouldDirty: true })} trackColor={{ true: "#1B87C9" }} />
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
        <>
          <Pressable onPress={() => setDeleteOpen(true)} className="mt-3 items-center py-2">
            <Text className="font-quicksand-semibold text-coral">Eliminar categoría</Text>
          </Pressable>
          <DeleteCategoryDialog
            category={category}
            visible={deleteOpen}
            onClose={() => setDeleteOpen(false)}
          />
        </>
      ) : null}
    </View>
  );
}
