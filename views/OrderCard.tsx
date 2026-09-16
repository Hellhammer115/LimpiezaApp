import { Pressable, Text, View } from "react-native";

import { STATUS_LABELS, STATUS_STYLES } from "@/models/orderStatus";
import type { Order } from "@/models/types";
import { formatDate, formatMXN } from "@/utils/format";

interface Props {
  order: Order;
  /** Admins see whose order it is. */
  showCustomer?: boolean;
  onPress: () => void;
}

/** VIEW — one row of the Pedidos tab (cotización or pedido). */
export function OrderCard({ order, showCustomer, onPress }: Props) {
  const [badgeBg, badgeText] = STATUS_STYLES[order.status];
  const isNew = order.status === "quote_requested";
  const kindLabel = order.paid_at ? "Pedido" : "Cotización";

  return (
    <Pressable
      onPress={onPress}
      className={`mb-3 rounded-2xl bg-white p-4 ${isNew ? "border border-citrus/60" : ""}`}
    >
      <View className="flex-row items-center justify-between">
        <Text className="font-quicksand-bold text-dark-100">
          {kindLabel} #{order.id.slice(0, 8)}
        </Text>
        <View className={`rounded-full px-3 py-1 ${badgeBg}`}>
          <Text className={`font-quicksand-bold text-xs ${badgeText}`}>
            {STATUS_LABELS[order.status]}
          </Text>
        </View>
      </View>
      {showCustomer ? (
        <Text className="mt-1 font-quicksand-semibold text-sm text-dark-100">
          {order.customer_name || order.customer_email}
        </Text>
      ) : null}
      <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/60">
        {formatDate(order.created_at)}
      </Text>
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="font-quicksand-medium text-sm text-dark-100/60">{order.delivery_slot || "Por definir"}</Text>
        <Text className="font-quicksand-bold text-base text-dark-100">
          {formatMXN(order.total_cents)}
        </Text>
      </View>
    </Pressable>
  );
}
