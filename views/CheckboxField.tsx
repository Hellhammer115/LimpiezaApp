import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { Pressable, Text, View } from "react-native";

interface Props<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  /** Label content; may contain inline links. */
  children: ReactNode;
}

/** VIEW — boolean checkbox bound to react-hook-form, with an inline error. */
export function CheckboxField<T extends FieldValues>({
  control,
  name,
  children,
}: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange }, fieldState }) => (
        <View className="mb-4 w-full">
          <View className="flex-row items-start gap-3">
            <Pressable
              onPress={() => onChange(!value)}
              hitSlop={8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!value }}
              className={`mt-0.5 size-6 items-center justify-center rounded-md border-2 ${
                value
                  ? "border-primary bg-primary"
                  : fieldState.error
                    ? "border-coral bg-white"
                    : "border-dark-100/30 bg-white"
              }`}
            >
              {value ? <Ionicons name="checkmark" size={16} color="white" /> : null}
            </Pressable>
            <View className="flex-1">{children}</View>
          </View>
          {fieldState.error ? (
            <Text className="mt-1 pl-9 font-quicksand-medium text-xs text-coral">
              {fieldState.error.message}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}
