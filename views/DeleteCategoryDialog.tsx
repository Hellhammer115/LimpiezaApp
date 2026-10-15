import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";

import { useAdminCategories, useDeleteCategory } from "@/controllers/useAdmin";
import type { AdminCategory } from "@/models/types";
import { Chip } from "@/views/Chip";

interface Props {
  category: AdminCategory;
  visible: boolean;
  onClose: () => void;
}

/**
 * VIEW — confirms a permanent category delete. When the category still has
 * products, the admin picks the category they move to; the server moves
 * them and deletes in one transaction.
 */
export function DeleteCategoryDialog({ category, visible, onClose }: Props) {
  const { data: categories, isLoading } = useAdminCategories();
  const deleteCategory = useDeleteCategory();
  const [moveTo, setMoveTo] = useState<string | null>(null);

  const count = category.product_count;
  const targets = (categories ?? []).filter((c) => c.id !== category.id);
  const needsTarget = count > 0;
  const canDelete = !deleteCategory.isPending && (!needsTarget || !!moveTo);

  const close = () => {
    if (deleteCategory.isPending) return;
    setMoveTo(null);
    onClose();
  };

  const confirm = async () => {
    try {
      await deleteCategory.mutateAsync({ id: category.id, moveTo: moveTo ?? undefined });
      onClose();
      router.back();
    } catch (error) {
      Alert.alert(
        "No se eliminó",
        error instanceof Error ? error.message : "No se pudo eliminar la categoría."
      );
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="max-h-[80%] w-full max-w-md rounded-2xl bg-white p-5">
          <Text className="font-quicksand-bold text-lg text-dark-100">
            Eliminar “{category.name}”
          </Text>
          <Text className="mt-2 font-quicksand-medium text-sm text-dark-100/70">
            Se eliminará de forma permanente y no se puede deshacer. Si solo quieres
            ocultarla, desactiva el interruptor “Activa”.
          </Text>

          {needsTarget ? (
            <>
              <Text className="mb-2 mt-4 font-quicksand-bold text-sm text-dark-100">
                {count === 1
                  ? "Tiene 1 producto. ¿A qué categoría lo movemos?"
                  : `Tiene ${count} productos. ¿A qué categoría los movemos?`}
              </Text>
              {isLoading ? (
                <ActivityIndicator className="my-4" color="#1B87C9" />
              ) : targets.length === 0 ? (
                <Text className="font-quicksand-medium text-sm text-coral">
                  No hay otra categoría. Crea una primero para mover los productos.
                </Text>
              ) : (
                <ScrollView className="max-h-60" contentContainerClassName="flex-row flex-wrap gap-y-2">
                  {targets.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.is_active ? c.name : `${c.name} (inactiva)`}
                      active={moveTo === c.id}
                      onPress={() => setMoveTo(c.id)}
                    />
                  ))}
                </ScrollView>
              )}
            </>
          ) : null}

          <Pressable
            onPress={confirm}
            disabled={!canDelete}
            className={`mt-5 items-center rounded-full bg-coral p-3 ${canDelete ? "" : "opacity-40"}`}
          >
            {deleteCategory.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="font-quicksand-bold text-base text-white">
                {needsTarget ? "Mover productos y eliminar" : "Eliminar definitivamente"}
              </Text>
            )}
          </Pressable>
          <Pressable onPress={close} className="mt-2 items-center py-2">
            <Text className="font-quicksand-semibold text-dark-100/60">Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
