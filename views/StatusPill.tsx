import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

import { statusBadge } from "@/models/orderStatus";

type Props = { order: Parameters<typeof statusBadge>[0] };

/** VIEW — the one status tag of an order/cotización (list rows and detail headers). */
export function StatusPill({ order }: Props) {
  const { label, style, highlight } = statusBadge(order);
  const [bg, text] = style;
  const icon: ComponentProps<typeof Ionicons>["name"] | null = highlight ? "sparkles" : null;

  return (
    <View className={`flex-row items-center rounded-full px-3 py-1 ${bg}`}>
      {icon ? <Ionicons name={icon} size={12} color="#F2B705" style={{ marginRight: 4 }} /> : null}
      <Text className={`font-quicksand-bold text-xs ${text}`}>{label}</Text>
    </View>
  );
}
