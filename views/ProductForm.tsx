// VIEW — shared form for creating and editing a product (admin only).
// Presence of `product` picks the mode: undefined = create, set = edit.
import { Ionicons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { z } from "zod";

import { useCategories } from "@/controllers/useCatalog";
import {
  useCreateProduct,
  useDeleteProduct,
  useUpdateProduct,
  useUploadProductImage,
} from "@/controllers/useAdmin";
import type { ProductInput } from "@/models/adminModel";
import type { AdminProduct } from "@/models/types";
import { formatDate } from "@/utils/format";
import { FormInput } from "@/views/FormInput";
import { PrimaryButton } from "@/views/PrimaryButton";

const schema = z.object({
  sku: z.string().trim(),
  sat_key: z.string().trim().regex(/^(\d{8})?$/, "La clave SAT tiene 8 dígitos"),
  name: z.string().trim().min(1, "Nombre requerido"),
  brand: z.string().trim(),
  code: z.string().trim(),
  description: z.string().trim(),
  category_id: z.string().uuid("Selecciona una categoría"),
  price: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Precio inválido"),
  dozen_price: z.string().trim().regex(/^(\d+(\.\d{1,2})?)?$/, "Precio inválido"),
  pieces_per_box: z.string().trim().regex(/^(0*[1-9]\d*)?$/, "Cantidad inválida"),
  unit: z.string().trim().min(1, "Unidad requerida"),
  stock: z.string().trim().regex(/^\d+$/, "Cantidad inválida"),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const toCents = (price: string) => Math.round(parseFloat(price) * 100);
const centsToField = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const orNull = (value: string) => value || null;
const optionalCents = (price: string) => (price ? toCents(price) : null);
const optionalInt = (value: string) => (value ? parseInt(value, 10) : null);

export function ProductForm({ product }: { product?: AdminProduct }) {
  const { data: categories } = useCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const uploadImage = useUploadProductImage();

  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sku: product?.sku ?? "",
      sat_key: product?.sat_key ?? "",
      name: product?.name ?? "",
      brand: product?.brand ?? "",
      code: product?.code ?? "",
      description: product?.description ?? "",
      category_id: product?.category_id ?? "",
      price: product ? centsToField(product.price_cents) : "",
      dozen_price: centsToField(product?.dozen_price_cents ?? null),
      pieces_per_box: product?.pieces_per_box ? String(product.pieces_per_box) : "",
      unit: product?.unit ?? "",
      stock: product ? String(product.stock) : "",
      is_active: product?.is_active ?? true,
    },
  });

  const categoryId = watch("category_id");
  const isActive = watch("is_active");

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso requerido", "Habilita acceso a tus fotos para elegir una imagen.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
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
      if (product) {
        // Edit mode: only send fields the admin actually changed in this
        // session. `product` comes from a query cache that can be stale
        // (e.g. stock decremented by a paid order in the background) —
        // sending the full snapshot would silently clobber that live value.
        const patch: Partial<ProductInput> = {};
        if (dirtyFields.sku) patch.sku = orNull(values.sku);
        if (dirtyFields.sat_key) patch.sat_key = orNull(values.sat_key);
        if (dirtyFields.name) patch.name = values.name;
        if (dirtyFields.brand) patch.brand = orNull(values.brand);
        if (dirtyFields.code) patch.code = orNull(values.code);
        if (dirtyFields.description) patch.description = values.description;
        if (dirtyFields.category_id) patch.category_id = values.category_id;
        if (dirtyFields.price) patch.price_cents = toCents(values.price);
        if (dirtyFields.dozen_price) patch.dozen_price_cents = optionalCents(values.dozen_price);
        if (dirtyFields.pieces_per_box) patch.pieces_per_box = optionalInt(values.pieces_per_box);
        if (dirtyFields.unit) patch.unit = values.unit;
        if (dirtyFields.stock) patch.stock = parseInt(values.stock, 10);
        if (dirtyFields.is_active) patch.is_active = values.is_active;
        if (imageUrl !== (product.image_url ?? null)) patch.image_url = imageUrl;

        await updateProduct.mutateAsync({ id: product.id, patch });
      } else {
        // Create mode: no prior server state to clobber, send everything.
        await createProduct.mutateAsync({
          category_id: values.category_id,
          name: values.name,
          description: values.description,
          price_cents: toCents(values.price),
          unit: values.unit,
          image_url: imageUrl,
          stock: parseInt(values.stock, 10),
          is_active: values.is_active,
          sku: orNull(values.sku),
          sat_key: orNull(values.sat_key),
          brand: orNull(values.brand),
          code: orNull(values.code),
          pieces_per_box: optionalInt(values.pieces_per_box),
          dozen_price_cents: optionalCents(values.dozen_price),
        });
      }
      router.back();
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "No se pudo guardar el producto."
      );
    }
  });

  const confirmDelete = () => {
    if (!product) return;
    Alert.alert("Eliminar producto", `¿Desactivar "${product.name}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteProduct.mutateAsync(product.id);
            router.back();
          } catch {
            Alert.alert("Error", "No se pudo eliminar el producto.");
          }
        },
      },
    ]);
  };

  const saving = createProduct.isPending || updateProduct.isPending;

  return (
    <View className="px-5 pb-10 pt-2">
      <Pressable
        onPress={pickImage}
        className="mb-4 h-40 items-center justify-center overflow-hidden rounded-2xl bg-white"
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
          />
        ) : (
          <View className="items-center">
            <Ionicons name="camera-outline" size={28} color="#3E8368" />
            <Text className="mt-1 font-quicksand-semibold text-sm text-dark-100/60">
              {uploadImage.isPending ? "Subiendo…" : "Agregar imagen"}
            </Text>
          </View>
        )}
      </Pressable>

      <FormInput control={control} name="sku" label="Clave" autoCapitalize="characters" />
      <FormInput control={control} name="name" label="Nombre" />
      <FormInput control={control} name="brand" label="Marca" />
      <FormInput control={control} name="description" label="Descripción" multiline />

      <Text className="label mb-1">Categoría</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {(categories ?? []).map((c) => {
          const active = c.id === categoryId;
          return (
            <Pressable
              key={c.id}
              onPress={() => setValue("category_id", c.id, { shouldValidate: true, shouldDirty: true })}
              className={active ? "chip-active" : "chip"}
            >
              <Text
                className={`font-quicksand-semibold text-sm ${active ? "text-white" : "text-dark-100"}`}
              >
                {c.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FormInput
        control={control}
        name="price"
        label="Precio por pieza (MXN)"
        keyboardType="decimal-pad"
      />
      <FormInput
        control={control}
        name="dozen_price"
        label="Precio por docena (MXN)"
        keyboardType="decimal-pad"
      />
      <FormInput
        control={control}
        name="pieces_per_box"
        label="Piezas por caja"
        keyboardType="number-pad"
      />
      <FormInput control={control} name="unit" label="Unidad" placeholder="kg, pieza, botella…" />
      <FormInput control={control} name="stock" label="Existencias" keyboardType="number-pad" />
      <FormInput control={control} name="code" label="Código" />
      <FormInput
        control={control}
        name="sat_key"
        label="Clave SAT"
        keyboardType="number-pad"
        maxLength={8}
      />

      <View className="mb-4 flex-row items-center justify-between rounded-2xl bg-white p-4">
        <Text className="font-quicksand-bold text-dark-100">Activo</Text>
        <Switch value={isActive} onValueChange={(v) => setValue("is_active", v, { shouldDirty: true })} trackColor={{ true: "#3E8368" }} />
      </View>

      {product ? (
        <Text className="mb-4 font-quicksand-medium text-xs text-dark-100/50">
          Última edición: {product.updated_by_email ?? "—"} · {formatDate(product.updated_at)}
        </Text>
      ) : null}

      <PrimaryButton
        title={product ? "Guardar cambios" : "Crear producto"}
        onPress={onSubmit}
        loading={saving}
      />

      {product ? (
        <Pressable onPress={confirmDelete} className="mt-3 items-center py-2">
          <Text className="font-quicksand-semibold text-coral">Eliminar producto</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
