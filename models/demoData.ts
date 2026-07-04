// MODEL — demo data: bundled sample catalog for backend-less previews.
import type { Category, Product, Profile } from "@/models/types";

// Preview-only mode: set EXPO_PUBLIC_DEMO=1 in .env to browse the app with
// bundled sample data and no backend. Auth and checkout are inert; queries
// resolve from the constants below. Never set this in a production build.
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO === "1";

const C = {
  ofertas: "c0000000-0000-4000-8000-000000000001",
  frutas: "c0000000-0000-4000-8000-000000000002",
  limpieza: "c0000000-0000-4000-8000-000000000003",
  lacteos: "c0000000-0000-4000-8000-000000000004",
  bebidas: "c0000000-0000-4000-8000-000000000005",
};

export const DEMO_CATEGORIES: Category[] = [
  { id: C.ofertas, name: "Ofertas", icon: "flash-outline", sort_order: 0 },
  { id: C.frutas, name: "Frutas y verduras", icon: "leaf-outline", sort_order: 1 },
  { id: C.limpieza, name: "Limpieza del hogar", icon: "sparkles-outline", sort_order: 2 },
  { id: C.lacteos, name: "Lácteos y huevo", icon: "nutrition-outline", sort_order: 3 },
  { id: C.bebidas, name: "Bebidas", icon: "water-outline", sort_order: 4 },
];

function product(
  id: number,
  categoryId: string,
  name: string,
  priceCents: number,
  unit: string,
  description: string,
  stock = 50
): Product {
  return {
    id: `d0000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    category_id: categoryId,
    name,
    description,
    price_cents: priceCents,
    unit,
    image_url: null,
    stock,
    is_active: true,
    created_at: new Date().toISOString(),
  };
}

export const DEMO_PRODUCTS: Product[] = [
  product(1, C.ofertas, "Detergente líquido 5L", 18900, "botella", "Detergente líquido para ropa, rinde hasta 60 cargas."),
  product(2, C.ofertas, "Papel higiénico 12 rollos", 9900, "paquete", "Paquete de 12 rollos, hoja doble."),
  product(3, C.ofertas, "Aguacate Hass (malla 1kg)", 6900, "kg", "Malla de aguacate Hass de primera.", 8),
  product(4, C.frutas, "Plátano", 2490, "kg", "Plátano tabasco fresco."),
  product(5, C.frutas, "Manzana roja", 5490, "kg", "Manzana red delicious."),
  product(6, C.frutas, "Jitomate saladet", 3290, "kg", "Jitomate saladet fresco del mercado."),
  product(7, C.frutas, "Limón sin semilla", 3990, "kg", "Limón persa jugoso.", 3),
  product(8, C.limpieza, "Cloro 1L", 2590, "botella", "Blanqueador desinfectante multiusos."),
  product(9, C.limpieza, "Limpiador multiusos 1L", 3490, "botella", "Limpiador líquido multiusos aroma lavanda."),
  product(10, C.limpieza, "Jabón lavatrastes 750ml", 4290, "botella", "Lavatrastes líquido arranca grasa."),
  product(11, C.limpieza, "Bolsas para basura grandes", 5690, "rollo", "Rollo con 25 bolsas resistentes 90x120cm.", 0),
  product(12, C.lacteos, "Leche entera 1L", 2790, "litro", "Leche entera pasteurizada."),
  product(13, C.lacteos, "Huevo blanco (30 piezas)", 8990, "cartera", "Cartera de 30 huevos frescos."),
  product(14, C.bebidas, "Agua purificada 6L", 3190, "garrafa", "Garrafón chico de agua purificada."),
  product(15, C.bebidas, "Refresco de cola 2L", 3890, "botella", "Refresco sabor cola familiar."),
];

export const DEMO_PROFILE: Profile = {
  user_id: "00000000-0000-4000-8000-000000000000",
  name: "Invitado",
  last_name: "Demo",
  phone: "5512345678",
  email: "demo@limpiezaapp.mx",
  photo_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
