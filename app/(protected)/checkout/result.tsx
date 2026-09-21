import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import type React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOrderPaymentStatus } from "@/controllers/useOrders";
import { PrimaryButton } from "@/views/PrimaryButton";

/**
 * VIEW — outcome screen for both "cotización enviada" and the Mercado Pago
 * return. The deep link params are NEVER trusted to decide anything — only
 * the order row (updated by the mp-webhook Edge Function) is. The controller
 * polls it only while a payment is pending.
 */
export default function CheckoutResult() {
  const { order_id: orderId } = useLocalSearchParams<{ order_id: string }>();
  const { data: order } = useOrderPaymentStatus(orderId);
  const status = order?.status;

  if (!order || status === "pending") {
    return (
      <Shell>
        <ActivityIndicator size="large" color="#3E8368" />
        <Title>{order ? "Confirmando tu pago…" : "Cargando…"}</Title>
        {order ? (
          <Subtitle>
            Esto puede tardar unos momentos. Si pagaste en efectivo (OXXO), tu pedido se
            confirmará cuando se acredite el pago.
          </Subtitle>
        ) : null}
        <View className="mt-8 w-full">
          <PrimaryButton title="Ver mis pedidos" onPress={() => router.replace("/orders")} />
        </View>
      </Shell>
    );
  }

  if (status === "quote_requested") {
    return (
      <Shell>
        <Badge color="primary" icon="paper-plane" />
        <Title>¡Cotización enviada!</Title>
        <Subtitle>
          Un asesor la revisará y te avisaremos cuando esté lista para pagar. Puedes seguirla
          en Pedidos → Cotizaciones.
        </Subtitle>
        <View className="mt-8 w-full gap-2">
          <PrimaryButton title="Ver cotización" onPress={() => router.replace(`/order/${order.id}`)} />
          <PrimaryButton title="Seguir comprando" onPress={() => router.replace("/")} />
        </View>
      </Shell>
    );
  }

  if (status === "quote_sent") {
    return (
      <Shell>
        <Badge color="coral" icon="close" />
        <Title>El pago no se completó</Title>
        <Subtitle>No se realizó ningún cargo. Tu cotización sigue vigente, puedes reintentar el pago.</Subtitle>
        <View className="mt-8 w-full gap-2">
          <PrimaryButton title="Ver cotización" onPress={() => router.replace(`/order/${order.id}`)} />
          <PrimaryButton title="Volver al inicio" onPress={() => router.replace("/")} />
        </View>
      </Shell>
    );
  }

  if (status === "cancelled") {
    return (
      <Shell>
        <Badge color="coral" icon="close" />
        <Title>Cotización cancelada</Title>
        <Subtitle>{order.admin_note ?? "Esta cotización ya no está activa."}</Subtitle>
        <View className="mt-8 w-full">
          <PrimaryButton title="Volver al inicio" onPress={() => router.replace("/")} />
        </View>
      </Shell>
    );
  }

  // paid (or any fulfilled state)
  return (
    <Shell>
      <Badge color="primary" icon="checkmark" />
      <Title>¡Pedido confirmado! 🎉</Title>
      <Subtitle>Tu pedido llegará {order.delivery_slot.toLowerCase()}.</Subtitle>
      <View className="mt-8 w-full gap-2">
        <PrimaryButton title="Ver mi pedido" onPress={() => router.replace(`/order/${order.id}`)} />
        <PrimaryButton title="Seguir comprando" onPress={() => router.replace("/")} />
      </View>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-mist px-8">{children}</SafeAreaView>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mt-6 text-center font-quicksand-bold text-2xl text-dark-100">{children}</Text>
  );
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mt-2 text-center font-quicksand-medium text-dark-100/60">{children}</Text>
  );
}

function Badge({ color, icon }: { color: "primary" | "coral"; icon: "checkmark" | "close" | "paper-plane" }) {
  const bg = color === "primary" ? "bg-primary/15" : "bg-coral/15";
  const tint = color === "primary" ? "#3E8368" : "#FF6B4A";
  return (
    <View className={`size-20 items-center justify-center rounded-full ${bg}`}>
      <Ionicons name={icon} size={40} color={tint} />
    </View>
  );
}
