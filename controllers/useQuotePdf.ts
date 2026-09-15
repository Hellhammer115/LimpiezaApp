// CONTROLLER — PDF export of a cotización/pedido. Native: render to a file
// and hand it to the OS share sheet (save / AirDrop / mail). Web: the
// browser print dialog, where "Guardar como PDF" is the download.
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Platform } from "react-native";

import { buildQuoteHtml } from "@/models/quoteDocument";
import type { OrderWithItems } from "@/models/types";

export function useQuotePdf() {
  const [generating, setGenerating] = useState(false);

  const download = async (order: OrderWithItems) => {
    setGenerating(true);
    try {
      const html = buildQuoteHtml(order);
      if (Platform.OS === "web") {
        await Print.printAsync({ html });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("PDF generado", `Guardado en: ${uri}`);
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: `Cotización #${order.id.slice(0, 8).toUpperCase()}`,
      });
    } catch (error) {
      Alert.alert(
        "No se pudo generar el PDF",
        error instanceof Error ? error.message : "Intenta de nuevo."
      );
    } finally {
      setGenerating(false);
    }
  };

  return { download, generating };
}
