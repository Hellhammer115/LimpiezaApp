import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCart } from "@/controllers/useCart";
import { useOrderPaymentStatus } from "@/controllers/useOrders";
import { PrimaryButton } from "@/views/PrimaryButton";

/**
 * VIEW — payment result. The deep link params from Mercado Pago are NEVER
 * trusted to decide the payment outcome — only the order row (updated by
 * the mp-webhook Edge Function) is. The controller polls it until the
 * payment settles, then the polling stops automatically.
 */
export default function CheckoutResult() {
  const { order_id: orderId } = useLocalSearchParams<{ order_id: string }>();
  const clearCart = useCart((s) => s.clear);

  const { data: order } = useOrderPaymentStatus(orderId);
  const status = order?.status;

  useEffect(() => {
    if (status === "paid") clearCart();
  }, [status, clearCart]);

  if (!order || status === "pending") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist px-8">
        <ActivityIndicator size="large" color="#3E8368" />
        <Text className="mt-6 text-center font-quicksand-bold text-xl text-dark-100">
          Confirmando tu pago…
        </Text>
        <Text className="mt-2 text-center font-quicksand-medium text-dark-100/60">
          Esto puede tardar unos momentos. Si pagaste en efectivo (OXXO), tu
          pedido se confirmará cuando se acredite el pago.
        </Text>
        <View className="mt-8 w-full">
          <PrimaryButton
            title="Ver mis pedidos"
            onPress={() => router.replace("/orders")}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (status === "cancelled") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist px-8">
        <View className="size-20 items-center justify-center rounded-full bg-coral/15">
          <Ionicons name="close" size={40} color="#FF6B4A" />
        </View>
        <Text className="mt-6 text-center font-quicksand-bold text-xl text-dark-100">
          El pago no se completó
        </Text>
        <Text className="mt-2 text-center font-quicksand-medium text-dark-100/60">
          No se realizó ningún cargo. Tu carrito sigue intacto, puedes
          intentarlo de nuevo.
        </Text>
        <View className="mt-8 w-full gap-2">
          <PrimaryButton
            title="Reintentar pago"
            onPress={() => router.replace("/checkout")}
          />
          <PrimaryButton
            title="Volver al inicio"
            onPress={() => router.replace("/")}
          />
        </View>
      </SafeAreaView>
    );
  }

  // paid (or any fulfilled state)
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-mist px-8">
      <View className="size-20 items-center justify-center rounded-full bg-primary/15">
        <Ionicons name="checkmark" size={40} color="#3E8368" />
      </View>
      <Text className="mt-6 text-center font-quicksand-bold text-2xl text-dark-100">
        ¡Pedido confirmado! 🎉
      </Text>
      <Text className="mt-2 text-center font-quicksand-medium text-dark-100/60">
        Tu pedido llegará {order.delivery_slot.toLowerCase()}.
      </Text>
      <View className="mt-8 w-full gap-2">
        <PrimaryButton
          title="Ver mi pedido"
          onPress={() => router.replace(`/order/${order.id}`)}
        />
        <PrimaryButton
          title="Seguir comprando"
          onPress={() => router.replace("/")}
        />
      </View>
    </SafeAreaView>
  );
}
