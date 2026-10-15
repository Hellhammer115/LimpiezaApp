import type { ReactNode } from "react";
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { Text, TextInput, View, type TextInputProps } from "react-native";

interface Props<T extends FieldValues> extends TextInputProps {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  /** Optional control drawn inside the input's right edge (e.g. an icon button). */
  trailing?: ReactNode;
}

/** VIEW — labeled text input bound to react-hook-form, with inline errors. */
export function FormInput<T extends FieldValues>({
  control,
  name,
  label,
  trailing,
  ...inputProps
}: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState }) => (
        <View className="mb-4 w-full">
          <Text className="label mb-1">{label}</Text>
          <View className="relative justify-center">
            <TextInput
              value={value ?? ""}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholderTextColor="rgba(15,42,61,0.35)"
              className={`input ${trailing ? "pr-12" : ""} ${
                fieldState.error ? "border-coral" : "border-dark-100/15"
              }`}
              {...inputProps}
            />
            {trailing ? (
              <View className="absolute bottom-0 right-0 top-0 justify-center pr-3">
                {trailing}
              </View>
            ) : null}
          </View>
          {fieldState.error ? (
            <Text className="mt-1 pl-2 font-quicksand-medium text-xs text-coral">
              {fieldState.error.message}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}
