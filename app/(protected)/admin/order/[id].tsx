// VIEW — admin detail of a cotización/pedido. The admin guard lives in
// app/(protected)/admin/_layout.tsx. Quotes are edited with QuoteEditor and
// saved through the admin-orders function; pedidos are read-only except for
// advancing the fulfillment status. Both can be exported as PDF.
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  useAdminDeleteQuote,
  useAdvanceOrder,
  useRejectQuote,
  useSendQuote,
  useUpdateQuote,
} from "@/controllers/useAdminOrders";
import { useOrder } from "@/controllers/useOrders";
import { useQuotePdf } from "@/controllers/useQuotePdf";
import {
  canDeleteQuote,
  FULFILLMENT_LABELS,
  isQuote,
  isQuoteEditable,
  nextFulfillmentStatus,
} from "@/models/orderStatus";
import type { OrderWithItems } from "@/models/types";
import { formatDate, formatMXN } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";
import { PrimaryButton } from "@/views/PrimaryButton";
import { draftFromOrder, draftToInput, QuoteEditor, type QuoteDraft } from "@/views/QuoteEditor";
import { ScreenHeader } from "@/views/ScreenHeader";
import { StatusPill } from "@/views/StatusPill";

export default function AdminOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);

  if (isLoading || !order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist">
        <ActivityIndicator color="#3E8368" />
      </SafeAreaView>
    );
  }
  return <Loaded order={order} />;
}

function Loaded({ order }: { order: OrderWithItems }) {
  const update = useUpdateQuote();
  const send = useSendQuote();
  const reject = useRejectQuote();
  const advance = useAdvanceOrder();
  const remove = useAdminDeleteQuote();
  const pdf = useQuotePdf();

  const editable = isQuoteEditable(order.status);
  // Only the admin's unsaved edits are stored; while there are none the draft
  // is derived from the server row, so a save or another admin's edit shows
  // up without an effect resyncing state (react-hooks/set-state-in-effect).
  const [edits, setEdits] = useState<QuoteDraft | null>(null);
  const dirty = edits !== null;
  const draft = edits ?? draftFromOrder(order);

  const onDraftChange = (d: QuoteDraft) => setEdits(d);

  // One action for every editable quote. A new request is accepted as-is
  // ("Aceptar") or with the admin's edits ("Guardar y enviar"); a quote the
  // customer already has is only saved ("Guardar cambios") and re-sent so they
  // get the "actualizada" email. Edits are saved first and a failed save
  // throws, so unsaved edits are never sent.
  const isNewRequest = order.status === "quote_requested";
  const actionTitle = isNewRequest ? (dirty ? "Guardar y enviar" : "Aceptar") : "Guardar cambios";

  const submit = async () => {
    try {
      if (dirty) {
        await update.mutateAsync({ id: order.id, input: draftToInput(draft) });
        setEdits(null);
      }
      await send.mutateAsync(order.id);
      Alert.alert(
        isNewRequest ? "Cotización enviada" : "Cambios guardados",
        isNewRequest
          ? "El cliente ya puede verla y pagarla."
          : "El cliente verá qué cambió y deberá aceptar los cambios para poder pagar."
      );
    } catch {
      // The mutation hooks already alerted.
    }
  };

  // Alert.prompt exists on iOS only. Elsewhere the admin writes the reason in
  // "Nota para el cliente" and saves; the reject action keeps a saved note.
  const rejectQuote = () => {
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Rechazar cotización",
        "Motivo (opcional, lo verá el cliente)",
        (note) => reject.mutate({ id: order.id, note }),
        "plain-text"
      );
      return;
    }
    Alert.alert(
      "Rechazar cotización",
      "¿Rechazar esta cotización? La nota guardada se mostrará al cliente.",
      [
        { text: "No", style: "cancel" },
        { text: "Rechazar", style: "destructive", onPress: () => reject.mutate({ id: order.id }) },
      ]
    );
  };

  const confirmDelete = () =>
    Alert.alert(
      "Eliminar cotización",
      "Se quitará de la lista de administración; el cliente la seguirá viendo.",
      [
      { text: "No", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: () => remove.mutate(order.id) },
    ]);

  const next = nextFulfillmentStatus(order.status);
  const busy =
    update.isPending || send.isPending || reject.isPending || advance.isPending || remove.isPending;

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <View className="flex-row items-center pr-5">
        <View className="flex-1">
          <ScreenHeader title={`${isQuote(order) ? "Cotización" : "Pedido"} #${order.id.slice(0, 8)}`} />
        </View>
        <Pressable
          onPress={() => pdf.download(order)}
          disabled={pdf.generating}
          className="h-10 flex-row items-center gap-1.5 rounded-full bg-white px-3"
        >
          {pdf.generating ? (
            <ActivityIndicator size="small" color="#3E8368" />
          ) : (
            <Ionicons name="download-outline" size={16} color="#3E8368" />
          )}
          <Text className="font-quicksand-semibold text-sm text-dark-100">PDF</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled">
        <View className="rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-quicksand-medium text-sm text-dark-100/60">
              {formatDate(order.created_at)}
            </Text>
            <StatusPill order={order} />
          </View>
          <Text className="mt-3 font-quicksand-bold text-dark-100">
            {order.customer_name || "Cliente"}
          </Text>
          <Text className="font-quicksand-medium text-sm text-dark-100/60">{order.customer_email}</Text>
          {order.customer_phone ? (
            <Text className="font-quicksand-medium text-sm text-dark-100/60">{order.customer_phone}</Text>
          ) : null}
          <Text className="mt-3 font-quicksand-bold text-dark-100">
            {order.delivery_slot || "Por definir"}
          </Text>
          <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/60">
            {order.delivery_address || "Por definir"}
          </Text>
        </View>

        <View className="mt-6">
          {editable ? (
            <QuoteEditor draft={draft} onChange={onDraftChange} />
          ) : (
            <>
              <Text className="mb-2 font-quicksand-bold text-lg text-dark-100">Productos</Text>
              <View className="rounded-2xl bg-white p-4">
                {order.order_items.map((item) => (
                  <View key={item.id} className="mb-2 flex-row justify-between">
                    <Text numberOfLines={1} className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/80">
                      {item.quantity}× {item.name}
                    </Text>
                    <Text className="font-quicksand-semibold text-sm text-dark-100">
                      {formatMXN(item.unit_price_cents * item.quantity)}
                    </Text>
                  </View>
                ))}
                <OrderTotals
                  subtotal={order.subtotal_cents}
                  discount={order.discount_cents}
                  discountPercent={order.discount_percent}
                  deliveryFee={order.delivery_fee_cents}
                  total={order.total_cents}
                />
              </View>
              {order.admin_note ? (
                <View className="mt-4 rounded-2xl bg-foam p-4">
                  <Text className="font-quicksand-bold text-sm text-primary">Nota</Text>
                  <Text className="mt-1 font-quicksand-medium text-sm text-dark-100">{order.admin_note}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      {editable ? (
        <View className="gap-2 border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
          <PrimaryButton
            title={actionTitle}
            onPress={submit}
            loading={update.isPending || send.isPending}
            // A sent quote has nothing to do until the admin changes something.
            disabled={busy || draft.items.length === 0 || (!isNewRequest && !dirty)}
          />
          <Pressable onPress={rejectQuote} disabled={busy} className="items-center py-2">
            <Text className="font-quicksand-bold text-sm text-coral">Rechazar</Text>
          </Pressable>
        </View>
      ) : next ? (
        <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
          <PrimaryButton
            title={`Marcar como ${FULFILLMENT_LABELS[next].toLowerCase()}`}
            onPress={() => advance.mutate({ id: order.id, to: next })}
            loading={advance.isPending}
          />
        </View>
      ) : canDeleteQuote(order) ? (
        <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
          <Pressable onPress={confirmDelete} disabled={busy} className="items-center py-2">
            <Text className="font-quicksand-bold text-sm text-coral">
              {remove.isPending ? "Eliminando…" : "Eliminar cotización"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
