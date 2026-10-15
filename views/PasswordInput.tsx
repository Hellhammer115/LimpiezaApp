import { Ionicons } from "@expo/vector-icons";
import { useState, type ComponentProps } from "react";
import type { FieldValues } from "react-hook-form";
import { Pressable } from "react-native";

import { FormInput } from "@/views/FormInput";

type Props<T extends FieldValues> = Omit<
  ComponentProps<typeof FormInput<T>>,
  "secureTextEntry" | "trailing"
>;

/** VIEW — password field with a show/hide toggle; hidden by default. */
export function PasswordInput<T extends FieldValues>(props: Props<T>) {
  const [visible, setVisible] = useState(false);

  return (
    <FormInput
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      secureTextEntry={!visible}
      trailing={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          <Ionicons
            name={visible ? "eye-off-outline" : "eye-outline"}
            size={22}
            color="rgba(16,36,31,0.55)"
          />
        </Pressable>
      }
    />
  );
}
