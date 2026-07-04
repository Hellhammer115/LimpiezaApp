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
}

/** VIEW — labeled text input bound to react-hook-form, with inline errors. */
export function FormInput<T extends FieldValues>({
  control,
  name,
  label,
  ...inputProps
}: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState }) => (
        <View className="mb-4 w-full">
          <Text className="label mb-1">{label}</Text>
          <TextInput
            value={value ?? ""}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholderTextColor="rgba(16,36,31,0.35)"
            className={`input ${
              fieldState.error ? "border-coral" : "border-dark-100/15"
            }`}
            {...inputProps}
          />
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
