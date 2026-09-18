import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import type { LineDiff, QuoteDiff } from "@/models/quoteRevision";
import type { OrderWithItems, QuoteSnapshot } from "@/models/types";
import { formatDate, formatMXN } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";

const TAGS: Record<Exclude<LineDiff["change"], "same">, [string, string, string]> = {
  added: ["Nuevo", "bg-primary/15", "text-primary"],
  removed: ["Eliminado", "bg-coral/15", "text-coral"],
  changed: ["Modificado", "bg-tide/15", "text-tide"],
};

const discountLabel = (cents: number, percent: number | null) =>
  cents === 0 ? "Sin descuento" : `−${formatMXN(cents)}${percent != null ? ` (${percent}%)` : ""}`;

const feeLabel = (cents: number) => (cents === 0 ? "Gratis" : formatMXN(cents));

interface ChangesProps {
  previous: QuoteSnapshot;
  order: OrderWithItems;
  diff: QuoteDiff;
  /** The customer still has to accept this update before paying. */
  pending: boolean;
}

/** VIEW — "your quote was updated" banner plus a line-by-line summary of what changed. */
export function QuoteChanges({ previous, order, diff, pending }: ChangesProps) {
  const changedLines = diff.lines.filter((l) => l.change !== "same");
  const delta = diff.totalDelta;

  return (
    <View className="mt-4">
      <View className={`flex-row rounded-2xl p-4 ${pending ? "bg-citrus/20" : "bg-foam"}`}>
        <Ionicons
          name={pending ? "sparkles" : "checkmark-circle"}
          size={20}
          color={pending ? "#F2B705" : "#3E8368"}
        />
        <View className="ml-3 flex-1">
          <Text className={`font-quicksand-bold ${pending ? "text-dark-100" : "text-primary"}`}>
            {pending ? "Tu cotización fue actualizada" : "Aceptaste los cambios"}
          </Text>
          <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/70">
            {order.quote_updated_at ? `${formatDate(order.quote_updated_at)} · ` : ""}
            {pending
              ? "Revisa qué cambió y acepta los cambios para poder pagar. Abajo verás la cotización actualizada y la anterior."
              : "Abajo verás la cotización actualizada y la anterior."}
          </Text>
        </View>
      </View>

      <Text className="mb-2 mt-6 font-quicksand-bold text-lg text-dark-100">Qué cambió</Text>
      <View className="rounded-2xl bg-white p-4">
        {changedLines.map((line) => {
          const [tag, tagBg, tagText] = TAGS[line.change as keyof typeof TAGS];
          return (
            <View key={line.key} className="mb-3">
              <View className="flex-row items-center justify-between">
                <Text
                  numberOfLines={1}
                  className={`flex-1 pr-3 font-quicksand-semibold text-sm text-dark-100 ${line.change === "removed" ? "line-through" : ""}`}
                >
                  {line.name}
                </Text>
                <View className={`rounded-full px-2 py-0.5 ${tagBg}`}>
                  <Text className={`font-quicksand-bold text-xs ${tagText}`}>{tag}</Text>
                </View>
              </View>
              <LineDetail line={line} />
            </View>
          );
        })}

        {diff.discountChanged ? (
          <ChangeRow
            label="Descuento"
            before={discountLabel(previous.discount_cents, previous.discount_percent)}
            after={discountLabel(order.discount_cents, order.discount_percent)}
          />
        ) : null}
        {diff.deliveryFeeChanged ? (
          <ChangeRow
            label="Envío"
            before={feeLabel(previous.delivery_fee_cents)}
            after={feeLabel(order.delivery_fee_cents)}
          />
        ) : null}
        {diff.noteChanged ? (
          <Text className="mb-3 font-quicksand-medium text-sm text-dark-100/70">
            La nota del asesor cambió.
          </Text>
        ) : null}

        <View className="border-t border-dark-100/5 pt-2">
          <View className="flex-row items-center justify-between">
            <Text className="font-quicksand-bold text-base text-dark-100">Total</Text>
            <View className="flex-row items-center">
              {delta !== 0 ? (
                <Text className="mr-2 font-quicksand-medium text-sm text-dark-100/50 line-through">
                  {formatMXN(previous.total_cents)}
                </Text>
              ) : null}
              <Text className="font-quicksand-bold text-base text-dark-100">
                {formatMXN(order.total_cents)}
              </Text>
            </View>
          </View>
          <Text
            className={`mt-1 text-right font-quicksand-semibold text-sm ${delta < 0 ? "text-primary" : delta > 0 ? "text-coral" : "text-dark-100/60"}`}
          >
            {delta === 0
              ? "El total no cambió"
              : delta < 0
                ? `Pagas ${formatMXN(-delta)} menos`
                : `Pagas ${formatMXN(delta)} más`}
          </Text>
        </View>
      </View>
    </View>
  );
}

function LineDetail({ line }: { line: LineDiff }) {
  const { before, after } = line;
  if (before && after) {
    return (
      <View className="mt-1">
        {before.quantity !== after.quantity ? (
          <Text className="font-quicksand-medium text-xs text-dark-100/60">
            Cantidad: {before.quantity} → {after.quantity}
          </Text>
        ) : null}
        {before.unit_price_cents !== after.unit_price_cents ? (
          <Text className="font-quicksand-medium text-xs text-dark-100/60">
            Precio unitario: {formatMXN(before.unit_price_cents)} → {formatMXN(after.unit_price_cents)}
          </Text>
        ) : null}
        <Text className="font-quicksand-medium text-xs text-dark-100/60">
          Importe: {formatMXN(before.quantity * before.unit_price_cents)} →{" "}
          {formatMXN(after.quantity * after.unit_price_cents)}
        </Text>
      </View>
    );
  }
  const only = before ?? after!;
  return (
    <Text className="mt-1 font-quicksand-medium text-xs text-dark-100/60">
      {only.quantity}× {formatMXN(only.unit_price_cents)} = {formatMXN(only.quantity * only.unit_price_cents)}
    </Text>
  );
}

function ChangeRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <View className="mb-3 flex-row items-center justify-between">
      <Text className="font-quicksand-semibold text-sm text-dark-100">{label}</Text>
      <Text className="font-quicksand-medium text-sm text-dark-100/70">
        {before} → {after}
      </Text>
    </View>
  );
}

/** VIEW — the version of the quote the customer saw before the admin's update. */
export function PreviousQuote({ previous }: { previous: QuoteSnapshot }) {
  return (
    <View>
      <Text className="mb-2 mt-6 font-quicksand-bold text-lg text-dark-100/60">
        Cotización anterior
      </Text>
      <View className="rounded-2xl border border-dark-100/10 bg-mist p-4 opacity-80">
        {previous.quoted_at ? (
          <Text className="mb-2 font-quicksand-medium text-xs text-dark-100/50">
            Enviada {formatDate(previous.quoted_at)}
          </Text>
        ) : null}
        {previous.items.map((item) => (
          <View key={item.id} className="mb-2 flex-row justify-between">
            <Text numberOfLines={1} className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/70">
              {item.quantity}× {item.name}
            </Text>
            <Text className="font-quicksand-semibold text-sm text-dark-100/70">
              {formatMXN(item.unit_price_cents * item.quantity)}
            </Text>
          </View>
        ))}
        <OrderTotals
          subtotal={previous.subtotal_cents}
          discount={previous.discount_cents}
          discountPercent={previous.discount_percent}
          deliveryFee={previous.delivery_fee_cents}
          total={previous.total_cents}
        />
        {previous.admin_note ? (
          <View className="mt-3 border-t border-dark-100/5 pt-2">
            <Text className="font-quicksand-bold text-xs text-dark-100/60">Nota del asesor</Text>
            <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/70">
              {previous.admin_note}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
