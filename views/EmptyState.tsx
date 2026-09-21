import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface Props {
  icon?: IconName;
  title: string;
  subtitle?: string;
}

/** VIEW — friendly placeholder for empty lists (no results, empty cart…). */
export function EmptyState({ icon = "leaf-outline", title, subtitle }: Props) {
  return (
    <View className="flex-1 items-center justify-center px-10 py-16">
      <View className="size-16 items-center justify-center rounded-full bg-foam">
        <Ionicons name={icon} size={28} color="#3E8368" />
      </View>
      <Text className="mt-4 text-center font-quicksand-bold text-lg text-dark-100">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-1 text-center font-quicksand-medium text-sm text-dark-100/60">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
