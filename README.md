# LimpiezaApp 🧼🥬

Aplicación de súper y limpieza a domicilio (estilo Calii) construida con
**Expo + React Native**, **Supabase** (Postgres, Auth, Edge Functions) y
**Mercado Pago Checkout Pro**.

## Arquitectura

- **App (Expo Router)**: catálogo, búsqueda, carrito (Zustand persistido),
  checkout y pedidos. Datos de servidor con TanStack Query.
- **Supabase**: todas las tablas tienen **Row Level Security**. Los clientes
  solo leen catálogo y sus propios datos; los pedidos los crea y actualiza
  exclusivamente el servidor.
- **Pagos**: `create-order` (Edge Function) recalcula precios desde la base
  de datos y crea la preferencia de Mercado Pago; `mp-webhook` valida la
  firma `x-signature`, consulta el pago a la API de MP y actualiza el pedido
  de forma idempotente. **La app nunca decide si un pago fue exitoso.**

La app sigue una arquitectura **Modelo–Vista–Controlador** (adaptada a
React Native: expo-router exige que las pantallas vivan en `app/`):

```
models/             MODELO — acceso a datos y reglas de dominio:
                    catálogo, pedidos, perfil, direcciones, auth, pagos,
                    carrito (zustand), datos demo, tipos
controllers/        CONTROLADOR — hooks que conectan modelos con vistas:
                    useCatalog, useOrders, useProfile, useAddresses,
                    useAuth (sesión), useCart, useCheckout (flujo de pago)
views/              VISTA — componentes reutilizables (ProductCard, etc.)
app/(auth)          VISTA — pantallas: sign-in / sign-up
app/(protected)     VISTA — pantallas: tabs, producto, categoría, carrito,
                    checkout, resultado de pago, pedidos
services/           infraestructura: cliente de Supabase (sesión cifrada)
utils/              utilidades puras (formato de moneda/fechas)
supabase/           migraciones SQL, seed, edge functions (lado servidor)
```

Las vistas nunca tocan Supabase directamente: siempre pasan por un
controlador, que a su vez usa un modelo.

## Configuración

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Instala la CLI y vincula el proyecto:
   ```sh
   npx supabase login
   npx supabase link --project-ref TU_PROJECT_REF
   ```
3. Aplica el esquema y la semilla:
   ```sh
   npx supabase db push
   psql "$DATABASE_URL" -f supabase/seed.sql   # o pega seed.sql en el SQL Editor
   ```
4. En **Authentication → Settings** activa la protección de contraseñas
   filtradas (leaked password protection).

### 2. Variables de entorno de la app

```sh
cp .env.example .env
# llena EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY
```

### 3. Mercado Pago + Edge Functions

1. Crea una aplicación en el [panel de desarrolladores de Mercado Pago](https://www.mercadopago.com.mx/developers)
   y copia el **Access Token** (usa credenciales de prueba primero).
2. Configura el webhook en el panel de MP apuntando a
   `https://TU_PROJECT_REF.supabase.co/functions/v1/mp-webhook`
   (evento: **Pagos**) y copia la **clave secreta** del webhook.
3. Sube los secretos y despliega las funciones:
   ```sh
   npx supabase secrets set MP_ACCESS_TOKEN=TEST-...
   npx supabase secrets set MP_WEBHOOK_SECRET=...
   npx supabase functions deploy create-order
   npx supabase functions deploy mp-webhook --no-verify-jwt
   ```
   (`mp-webhook` valida la firma HMAC de MP en lugar de un JWT.)

### 4. Correr la app

```sh
npm install
npx expo start
```

## Pruebas de pago (sandbox)

Usa las [tarjetas de prueba de Mercado Pago](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards):
aprobada (`APRO`), rechazada (`OTHE`) y pendiente. Verifica que:

- Un pago aprobado marca el pedido como **Pagado** aunque cierres la app
  a media transacción (el webhook es la fuente de verdad).
- Reenviar la notificación del webhook no duplica nada (idempotencia).
- Cambiar precios desde el cliente no afecta el cobro (el servidor recalcula).

## Seguridad

- RLS en todas las tablas; catálogo de solo lectura, pedidos solo por servidor.
- La contraseña vive únicamente (hasheada) en Supabase Auth.
- Sesión cifrada en el dispositivo (AES-256, llave en Keychain/Keystore).
- Secretos de MP solo en Edge Functions (`supabase secrets`), nunca en la app.
- `.env` está en `.gitignore`; solo se publica la URL y la anon key.
