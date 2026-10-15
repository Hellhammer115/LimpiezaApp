-- Legal documents (Términos y Condiciones, Aviso de Privacidad) and the
-- record of who accepted which version, when.
--
-- Evidence model:
--   * legal_documents rows are immutable once inserted. A change means a new
--     version row, so the exact text any user accepted stays retrievable.
--   * legal_acceptances is written ONLY server-side: by handle_new_user at
--     sign-up (source 'sign_up') or by accept_legal_documents when an
--     existing user accepts a newer version (source 're_accept'). The
--     timestamp is the server's now(), never a client value.
--   * The latest published version per slug is "current". Publishing a new
--     version (insert with a higher version) makes every user who hasn't
--     accepted it see the re-acceptance gate in the app.

-- ---------------------------------------------------------------------------
-- DOCUMENTS
-- ---------------------------------------------------------------------------
create table public.legal_documents (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null check (slug in ('terms', 'privacy')),
  version      integer not null check (version > 0),
  title        text not null,
  body         text not null,
  -- May be set in the future to schedule a version; it becomes current then.
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (slug, version)
);

alter table public.legal_documents enable row level security;

create policy "legal_documents: read published"
  on public.legal_documents for select
  to anon, authenticated
  using (published_at <= now());

revoke insert, update, delete, truncate on public.legal_documents
  from anon, authenticated;

create or replace function public.legal_documents_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'legal_documents are immutable; publish a new version instead'
    using errcode = '42501';
end;
$$;

revoke execute on function public.legal_documents_immutable()
  from public, anon, authenticated;

create trigger legal_documents_no_update
  before update or delete on public.legal_documents
  for each row execute function public.legal_documents_immutable();

create trigger legal_documents_no_truncate
  before truncate on public.legal_documents
  for each statement execute function public.legal_documents_immutable();

-- Latest published version of each document.
create view public.current_legal_documents
  with (security_invoker = true)
as
  select distinct on (slug) id, slug, version, title, body, published_at
  from public.legal_documents
  where published_at <= now()
  order by slug, version desc;

grant select on public.current_legal_documents to anon, authenticated;

-- ---------------------------------------------------------------------------
-- ACCEPTANCES
-- ---------------------------------------------------------------------------
create table public.legal_acceptances (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.legal_documents (id),
  source      text not null check (source in ('sign_up', 're_accept')),
  accepted_at timestamptz not null default now(),
  unique (user_id, document_id)
);

alter table public.legal_acceptances enable row level security;

create policy "legal_acceptances: select own"
  on public.legal_acceptances for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete, truncate on public.legal_acceptances
  from anon, authenticated;

-- Current documents the caller hasn't accepted. SECURITY INVOKER: RLS on
-- legal_acceptances already scopes the lookup to the caller.
create or replace function public.pending_legal_documents()
returns setof public.current_legal_documents
language sql
stable
set search_path = public
as $$
  select c.*
  from public.current_legal_documents c
  where not exists (
    select 1
    from public.legal_acceptances a
    where a.document_id = c.id
      and a.user_id = auth.uid()
  );
$$;

revoke execute on function public.pending_legal_documents()
  from public, anon, authenticated;
grant execute on function public.pending_legal_documents()
  to authenticated;

-- Records the caller's acceptance of current document versions. Refuses any
-- id that isn't the current version of its document, so a client can only
-- accept exactly what is published right now.
create or replace function public.accept_legal_documents(p_document_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_document_ids), 0) = 0 then
    raise exception 'no documents to accept' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_document_ids) as d (id)
    where d.id is null
       or d.id not in (select c.id from public.current_legal_documents c)
  ) then
    raise exception 'document version is not current' using errcode = '22023';
  end if;

  insert into public.legal_acceptances (user_id, document_id, source)
  select distinct v_user, d.id, 're_accept'
  from unnest(p_document_ids) as d (id)
  on conflict (user_id, document_id) do nothing;
end;
$$;

revoke execute on function public.accept_legal_documents(uuid[])
  from public, anon, authenticated;
grant execute on function public.accept_legal_documents(uuid[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- SIGN-UP: require + record acceptance
-- ---------------------------------------------------------------------------
-- Replaces the initial-schema version. The client sends the versions it
-- displayed as signup metadata (terms_version / privacy_version); both must
-- be the current ones or the whole sign-up is rolled back. The profile
-- fields are checked by the profiles CHECK constraints
-- (20261014120000_profile_checks.sql); the phone is required here.
-- CREATE OR REPLACE keeps the function's existing (revoked) privileges.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terms   uuid;
  v_privacy uuid;
begin
  select c.id into v_terms
  from public.current_legal_documents c
  where c.slug = 'terms'
    and c.version::text = new.raw_user_meta_data ->> 'terms_version';

  select c.id into v_privacy
  from public.current_legal_documents c
  where c.slug = 'privacy'
    and c.version::text = new.raw_user_meta_data ->> 'privacy_version';

  if v_terms is null or v_privacy is null then
    raise exception 'current legal documents must be accepted to sign up'
      using errcode = '23514';
  end if;

  if new.raw_user_meta_data ->> 'phone' is null then
    raise exception 'phone is required' using errcode = '23514';
  end if;

  insert into public.profiles (user_id, email, name, last_name, phone)
  values (
    new.id,
    new.email,
    btrim(coalesce(new.raw_user_meta_data ->> 'name', '')),
    btrim(coalesce(new.raw_user_meta_data ->> 'last_name', '')),
    btrim(new.raw_user_meta_data ->> 'phone')
  );

  insert into public.legal_acceptances (user_id, document_id, source)
  values
    (new.id, v_terms, 'sign_up'),
    (new.id, v_privacy, 'sign_up');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- SEED: version 1 (PLANTILLA — requiere revisión legal antes de producción)
-- ---------------------------------------------------------------------------
insert into public.legal_documents (slug, version, title, body) values
(
  'terms', 1, 'Términos y Condiciones',
  $body$PLANTILLA — ESTE TEXTO REQUIERE REVISIÓN LEGAL ANTES DE PUBLICARSE.

1. Identidad del proveedor
[Razón social], con domicilio en [domicilio], RFC [RFC] (en adelante, "LimpiezaApp"), ofrece a través de esta aplicación la venta y entrega a domicilio de productos de limpieza, abarrotes, frutas y verduras.

2. Aceptación
Al crear una cuenta y marcar la casilla de aceptación, declaras haber leído y aceptado estos Términos y Condiciones y el Aviso de Privacidad. Si no estás de acuerdo, no debes usar la aplicación. Debes ser mayor de edad y tener capacidad legal para contratar.

3. Cuenta
Eres responsable de la veracidad de los datos que registras y de mantener la confidencialidad de tu contraseña. Avísanos de inmediato si detectas un uso no autorizado de tu cuenta.

4. Cotizaciones, precios y pagos
Los pedidos se solicitan como cotización. LimpiezaApp revisa disponibilidad y envía la cotización final, que puede incluir ajustes. Solo al pagar la cotización aceptada se formaliza la compra. Los precios están en pesos mexicanos (MXN) e incluyen IVA salvo indicación en contrario. Los pagos se procesan a través de Mercado Pago; LimpiezaApp no almacena los datos de tu tarjeta.

5. Entrega
Las entregas se realizan en la dirección y el horario elegidos, dentro de la zona de cobertura. El costo de envío se muestra antes del pago.

6. Cancelaciones, devoluciones y garantías
Puedes cancelar una cotización mientras no esté pagada. Para pedidos pagados, aplican las políticas de devolución y reembolso de [describir], sin perjuicio de los derechos que te otorga la Ley Federal de Protección al Consumidor.

7. Uso aceptable
Queda prohibido usar la aplicación con fines fraudulentos, automatizar el acceso o interferir con su funcionamiento.

8. Cambios a estos términos
Podemos actualizar estos términos. Te pediremos aceptar la nueva versión antes de seguir usando la aplicación.

9. Atención a clientes
[correo] · [teléfono]. También puedes acudir a la Procuraduría Federal del Consumidor (PROFECO).

10. Legislación y jurisdicción
Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para su interpretación, las partes se someten a los tribunales competentes de [ciudad], sin perjuicio de la competencia de PROFECO.$body$
),
(
  'privacy', 1, 'Aviso de Privacidad',
  $body$PLANTILLA — ESTE TEXTO REQUIERE REVISIÓN LEGAL ANTES DE PUBLICARSE.

Aviso de Privacidad Integral, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.

1. Responsable
[Razón social], con domicilio en [domicilio], es responsable del tratamiento de tus datos personales.

2. Datos que recabamos
Nombre, apellido, teléfono, correo electrónico, direcciones de entrega e historial de pedidos y pagos. No recabamos datos personales sensibles. Los datos de tarjeta los procesa directamente Mercado Pago.

3. Finalidades primarias (necesarias)
Crear y administrar tu cuenta; elaborar cotizaciones; procesar pagos; entregar pedidos; atención a clientes; cumplir obligaciones legales y fiscales; prevenir fraude y abuso (incluida la verificación anti-bots hCaptcha).

4. Finalidades secundarias
[p. ej., promociones y encuestas]. Puedes negarte a ellas escribiendo a [correo] sin que ello afecte el servicio.

5. Transferencias y encargados
Compartimos datos solo con los encargados necesarios para prestar el servicio: proveedor de infraestructura y base de datos (Supabase), procesador de pagos (Mercado Pago), servicio de correo transaccional (Resend), verificación anti-bots (hCaptcha) y, en su caso, repartidores. No vendemos tus datos.

6. Derechos ARCO y revocación del consentimiento
Puedes ejercer tus derechos de Acceso, Rectificación, Cancelación y Oposición, o revocar tu consentimiento, enviando una solicitud a [correo] con tu nombre, medio para comunicarte la respuesta, documento que acredite tu identidad y la descripción de tu solicitud. Responderemos en los plazos que marca la ley.

7. Limitación de uso y divulgación
Puedes limitar el uso de tus datos escribiendo a [correo].

8. Cookies y tecnologías similares
La versión web usa almacenamiento local para mantener tu sesión y tu carrito.

9. Cambios al aviso
Te notificaremos cualquier cambio en la aplicación y te pediremos aceptar la nueva versión.

Fecha de última actualización: [fecha].$body$
);
