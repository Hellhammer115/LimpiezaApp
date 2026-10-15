import { Ionicons } from "@expo/vector-icons";
import { useState, type ComponentProps } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Icons that fit a grocery / cleaning catalog, tagged in Spanish so admins
 * can search them. Shown first; a search also matches every Ionicons
 * outline icon by its (English) name.
 */
const CURATED: { name: IconName; tags: string }[] = [
  { name: "flash-outline", tags: "ofertas promociones rayo descuento" },
  { name: "pricetag-outline", tags: "precio etiqueta ofertas descuento" },
  { name: "pricetags-outline", tags: "precios etiquetas ofertas" },
  { name: "star-outline", tags: "destacados favoritos estrella" },
  { name: "gift-outline", tags: "regalo paquetes promocion" },
  { name: "leaf-outline", tags: "frutas verduras organico hoja natural" },
  { name: "nutrition-outline", tags: "frutas manzana nutricion saludable" },
  { name: "flower-outline", tags: "flores jardin" },
  { name: "egg-outline", tags: "huevo huevos lacteos" },
  { name: "fish-outline", tags: "pescado mariscos" },
  { name: "pizza-outline", tags: "comida pizza congelados" },
  { name: "fast-food-outline", tags: "comida rapida botanas" },
  { name: "ice-cream-outline", tags: "helado postres congelados" },
  { name: "cafe-outline", tags: "cafe te desayuno" },
  { name: "beer-outline", tags: "cerveza bebidas alcohol" },
  { name: "wine-outline", tags: "vino licores bebidas" },
  { name: "water-outline", tags: "agua bebidas liquidos" },
  { name: "pint-outline", tags: "bebidas vaso refrescos" },
  { name: "restaurant-outline", tags: "comida despensa cocina abarrotes" },
  { name: "fast-food-outline", tags: "botanas snacks" },
  { name: "basket-outline", tags: "canasta despensa abarrotes super" },
  { name: "cart-outline", tags: "carrito super compras" },
  { name: "bag-handle-outline", tags: "bolsa compras" },
  { name: "cube-outline", tags: "caja mayoreo paquete" },
  { name: "file-tray-stacked-outline", tags: "mayoreo cajas almacen" },
  { name: "sparkles-outline", tags: "limpieza brillo hogar" },
  { name: "flask-outline", tags: "quimicos limpiadores liquidos" },
  { name: "beaker-outline", tags: "quimicos cloro desinfectante" },
  { name: "color-fill-outline", tags: "liquidos cubeta limpieza pintura" },
  { name: "brush-outline", tags: "cepillo escoba limpieza" },
  { name: "trash-outline", tags: "basura bolsas desechos" },
  { name: "shirt-outline", tags: "ropa lavanderia detergente" },
  { name: "water-outline", tags: "lavanderia jabon liquido" },
  { name: "home-outline", tags: "hogar casa" },
  { name: "bed-outline", tags: "recamara blancos" },
  { name: "medkit-outline", tags: "farmacia botiquin salud" },
  { name: "medical-outline", tags: "farmacia medicina salud" },
  { name: "bandage-outline", tags: "curitas primeros auxilios" },
  { name: "fitness-outline", tags: "salud ejercicio" },
  { name: "happy-outline", tags: "cuidado personal higiene" },
  { name: "rose-outline", tags: "belleza cuidado personal" },
  { name: "eyedrop-outline", tags: "gotas cuidado personal" },
  { name: "paw-outline", tags: "mascotas perro gato" },
  { name: "happy-outline", tags: "bebes infantil" },
  { name: "construct-outline", tags: "ferreteria herramientas" },
  { name: "hammer-outline", tags: "ferreteria herramientas" },
  { name: "bulb-outline", tags: "focos electricos iluminacion" },
  { name: "battery-charging-outline", tags: "pilas baterias" },
  { name: "flame-outline", tags: "gas encendedor cocina" },
  { name: "snow-outline", tags: "congelados refrigerados frio" },
  { name: "thermometer-outline", tags: "refrigerados temperatura" },
  { name: "sunny-outline", tags: "temporada verano" },
  { name: "car-outline", tags: "automotriz auto" },
  { name: "school-outline", tags: "escolar papeleria" },
  { name: "document-text-outline", tags: "papeleria oficina papel" },
  { name: "print-outline", tags: "oficina impresion" },
  { name: "storefront-outline", tags: "tienda negocio" },
  { name: "business-outline", tags: "empresas institucional" },
  { name: "heart-outline", tags: "favoritos salud" },
];

// Dedupe by name (some icons carry two tag sets) while keeping order.
const CURATED_NAMES = [...new Set(CURATED.map((c) => c.name))];
const TAGS_BY_NAME = new Map<IconName, string>();
for (const { name, tags } of CURATED) {
  TAGS_BY_NAME.set(name, `${TAGS_BY_NAME.get(name) ?? ""} ${tags}`);
}
const ALL_OUTLINE = (Object.keys(Ionicons.glyphMap) as IconName[]).filter((n) =>
  n.endsWith("-outline")
);

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function searchIcons(query: string): IconName[] {
  const q = normalize(query);
  if (!q) return CURATED_NAMES;
  const curated = CURATED_NAMES.filter(
    (n) => normalize(TAGS_BY_NAME.get(n) ?? "").includes(q) || n.includes(q)
  );
  const rest = ALL_OUTLINE.filter((n) => n.includes(q) && !curated.includes(n));
  return [...curated, ...rest];
}

interface Props {
  value: string;
  onChange: (icon: IconName) => void;
}

/** VIEW — current-icon button that opens a searchable icon grid in a modal. */
export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = searchIcons(query);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="mb-4 flex-row items-center gap-3 rounded-2xl bg-white p-3"
      >
        <View className="size-11 items-center justify-center rounded-full bg-primary">
          <Ionicons name={value as IconName} size={22} color="white" />
        </View>
        <Text className="flex-1 font-quicksand-semibold text-dark-100">Cambiar ícono</Text>
        <Ionicons name="chevron-forward" size={18} color="rgba(15,42,61,0.4)" />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <SafeAreaView className="flex-1 bg-mist">
          <View className="flex-row items-center gap-3 px-5 pb-3 pt-4">
            <Text className="flex-1 font-quicksand-bold text-xl text-dark-100">Elige un ícono</Text>
            <Pressable onPress={close} hitSlop={8} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={24} color="#0F2A3D" />
            </Pressable>
          </View>
          <View className="px-5 pb-3">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar: limpieza, frutas, bebidas…"
              placeholderTextColor="rgba(15,42,61,0.35)"
              autoCorrect={false}
              autoCapitalize="none"
              className="input border-dark-100/15"
            />
          </View>
          <FlatList
            data={results}
            keyExtractor={(name) => name}
            numColumns={5}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="px-4 pb-10"
            columnWrapperClassName="gap-2 mb-2"
            renderItem={({ item }) => {
              const active = item === value;
              return (
                <Pressable
                  onPress={() => {
                    onChange(item);
                    close();
                  }}
                  accessibilityLabel={item}
                  // Fixed basis (not flex-1) so a short last row doesn't stretch.
                  style={{ flexBasis: "17.5%" }}
                  className={`aspect-square items-center justify-center rounded-2xl ${
                    active ? "bg-primary" : "bg-white"
                  }`}
                >
                  <Ionicons name={item} size={26} color={active ? "white" : "#1B87C9"} />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text className="mt-10 text-center font-quicksand-medium text-dark-100/60">
                Sin resultados. Prueba otra palabra (también en inglés: “soap”, “apple”…).
              </Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
